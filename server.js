
require('dotenv').config();
const express=require('express');
const http=require('http');
const {Server}=require('socket.io');
const bcrypt=require('bcryptjs');
const jwt=require('jsonwebtoken');
const cors=require('cors');
const helmet=require('helmet');
const rateLimit=require('express-rate-limit');
const fs=require('fs');
const path=require('path');
const nodemailer=require('nodemailer');
// Node 18+ has global fetch for Brevo/Resend API
const multer=require('multer');

const app=express();
app.set('trust proxy', 1); // Fix for Render proxy
const server=http.createServer(app);
const io=new Server(server,{cors:{origin:"*"}});
const PORT=process.env.PORT||3000;
const JWT_SECRET=process.env.JWT_SECRET||"dev_secret_change";
const ADMIN_SECRET=process.env.ADMIN_SECRET||"admin_secret";
const ADMIN_EMAIL=process.env.ADMIN_EMAIL||"owner@markethub.com";
const ADMIN_PASSWORD=process.env.ADMIN_PASSWORD||"OwnerStrongPass123";
const DB_PATH=path.join(__dirname,'data','db.json');
// Ensure data folder
try{
  if(!fs.existsSync(path.join(__dirname,'data'))) fs.mkdirSync(path.join(__dirname,'data'),{recursive:true});
  if(!fs.existsSync(DB_PATH)) fs.writeFileSync(DB_PATH, JSON.stringify({users:[],products:[],orders:[],reports:[],otps:[],logs:[]},null,2));
  if(!fs.existsSync(path.join(__dirname,'public','uploads'))) fs.mkdirSync(path.join(__dirname,'public','uploads'),{recursive:true});
}catch(e){}
const smtpUser=(process.env.SMTP_USER||'').trim();
const smtpPass=(process.env.SMTP_PASS||'').replace(/\s/g,'').trim();
const smtpHost=(process.env.SMTP_HOST||'smtp.gmail.com').trim();
const smtpPort=parseInt((process.env.SMTP_PORT||'587').trim());
const brevoKey=(process.env.BREVO_API_KEY||'').trim();
const resendKey=(process.env.RESEND_API_KEY||'').trim();
console.log('=== EMAIL DEBUG ===');
console.log('SMTP HOST:', smtpHost, 'PORT:', smtpPort);
console.log('SMTP USER:', smtpUser ? smtpUser.slice(0,3)+'***@'+smtpUser.split('@').pop() : 'MISSING');
console.log('SMTP PASS len:', smtpPass.length);
console.log('BREVO KEY present:', !!brevoKey);
console.log('RESEND KEY present:', !!resendKey);
console.log('===================');
const emailConfigured=!!(smtpUser && smtpPass) || !!brevoKey || !!resendKey;

// Ensure data folder and db file exist for Render
try{
  if(!fs.existsSync(path.join(__dirname,'data'))) fs.mkdirSync(path.join(__dirname,'data'),{recursive:true});
  if(!fs.existsSync(DB_PATH)) fs.writeFileSync(DB_PATH, JSON.stringify({users:[],products:[],orders:[],reports:[],otps:[],logs:[]},null,2));
  if(!fs.existsSync(path.join(__dirname,'public','uploads'))) fs.mkdirSync(path.join(__dirname,'public','uploads'),{recursive:true});
}catch(e){ console.log('Init folders error', e.message); }

const MAIL_FROM_NAME=process.env.MAIL_FROM_NAME||"MarketHub";

function readDB(){try{return JSON.parse(fs.readFileSync(DB_PATH,'utf8'));}catch{return{users:[],products:[],orders:[],reports:[],otps:[],logs:[]}}}
function writeDB(d){ try{ const dir=path.dirname(DB_PATH); if(!fs.existsSync(dir)) fs.mkdirSync(dir,{recursive:true}); fs.writeFileSync(DB_PATH,JSON.stringify(d,null,2)); }catch(e){ console.error('writeDB error', e.message); } }
function addLog(a,d){const db=readDB();db.logs.unshift({id:Date.now(),time:new Date().toISOString(),action:a,details:d});if(db.logs.length>500)db.logs=db.logs.slice(0,500);writeDB(db);}
function genOrderCode(){const c="ABCDEFGHJKLMNPQRSTUVWXYZ23456789";let s="MH-";for(let i=0;i<6;i++)s+=c[Math.floor(Math.random()*c.length)];return s;}
function genOTP(){return Math.floor(100000+Math.random()*900000).toString();}
function isUserSuspended(user){
  if(!user) return {suspended:false};
  if(user.banned) return {suspended:true, permanent:true, reason:user.banReason||'Banned by admin'};
  if(user.suspendedUntil && Date.now() < user.suspendedUntil){
    const daysLeft=Math.ceil((user.suspendedUntil - Date.now())/(1000*60*60*24));
    return {suspended:true, permanent:false, until:user.suspendedUntil, daysLeft, reason:user.suspensionReason};
  }
  return {suspended:false};
}

// Mail
let transporter=null, emailReady=false;
if(process.env.SMTP_USER && process.env.SMTP_PASS){
  transporter=nodemailer.createTransport({
    host:process.env.SMTP_HOST||'smtp.gmail.com',
    port:Number(process.env.SMTP_PORT||587),
    secure:false,
    auth:{user:process.env.SMTP_USER, pass:process.env.SMTP_PASS.replace(/\s/g,'')},
    tls:{rejectUnauthorized:false}
  });
  transporter.verify((err)=>{ if(err){console.log("❌ SMTP failed:",err.message); emailReady=false;} else {console.log(`✅ Mail ready: ${process.env.SMTP_USER}`); emailReady=true;} });
}else{ console.log("⚠️ Dev mode - No SMTP. Codes shown in console for testing."); }

async function sendMail(to, subject, text, html){
  if(!transporter || !emailReady){ console.log(`[DEV MAIL] To:${to} Subject:${subject} Text:${text}`); return {sent:false, devMode:true}; }
  try{ await sendEmail(email, `MarketHub ${type} code`, code, type)({from:`${MAIL_FROM_NAME} <${process.env.SMTP_USER}>`,to,subject,text,html}); console.log(`📧 Sent to ${to}: ${subject}`); return {sent:true}; }
  catch(e){ console.log(`❌ Mail fail ${to}: ${e.message}`); return {sent:false, error:e.message}; }
}

// Upload 5MB
const uploadDir=path.join(__dirname,'public','uploads');
if(!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir,{recursive:true});
const storage=multer.diskStorage({
  destination:(req,file,cb)=>cb(null,uploadDir),
  filename:(req,file,cb)=>{ const ext=path.extname(file.originalname)||'.jpg'; cb(null, Date.now()+'_'+Math.random().toString(36).slice(2,7)+ext); }
});
const upload=multer({storage, limits:{fileSize:5*1024*1024}, fileFilter:(req,file,cb)=>{ if(file.mimetype.startsWith('image/')) cb(null,true); else cb(new Error('Only images')); }});

(() => {
  const db=readDB();
  if(!db.users.find(u=>u.email===ADMIN_EMAIL)){
    const h=bcrypt.hashSync(ADMIN_PASSWORD,12);
    db.users.push({id:'admin_'+Date.now(),username:'Owner',email:ADMIN_EMAIL,phone:'',password:h,role:'admin',isEmailVerified:true,isPhoneVerified:true,reportCount:0,deliveredCount:0,isVerifiedSeller:true,createdAt:new Date().toISOString()});
    writeDB(db); console.log(`Admin: ${ADMIN_EMAIL}`);
  }
})();

app.use(helmet({contentSecurityPolicy:false}));
app.use(cors());
app.use(express.json({limit:'10mb'}));
app.use(express.urlencoded({extended:true,limit:'10mb'}));
app.use(express.static(path.join(__dirname,'public')));
app.use('/uploads', express.static(path.join(__dirname,'public','uploads')));
app.use("/api/", rateLimit({windowMs:15*60*1000,max:1000}));

function auth(req,res,next){const t=req.headers.authorization?.split(' ')[1];if(!t)return res.status(401).json({error:"No token"});try{
  const decoded=jwt.verify(t,JWT_SECRET);
  const db=readDB(); const user=db.users.find(u=>u.id===decoded.id);
  if(user){ const s=isUserSuspended(user); if(s.suspended){ if(s.permanent) return res.status(403).json({error:"Your account has been permanently banned. Contact support."}); else return res.status(403).json({error:`Your account is suspended for ${s.daysLeft} more day(s). Until ${new Date(s.until).toLocaleDateString()}. Reason: ${s.reason||''}`}); } }
  req.user=decoded; next();
}catch{return res.status(401).json({error:"Invalid token"});}}

function adminAuth(req,res,next){
  if(req.headers['x-admin-secret']!==ADMIN_SECRET) return res.status(403).json({error:"Wrong ADMIN_SECRET - Check your .env ADMIN_SECRET"});
  const t=req.headers.authorization?.split(' ')[1];if(!t)return res.status(401).json({error:"No token"});
  try{const u=jwt.verify(t,JWT_SECRET);if(u.role!=='admin')return res.status(403).json({error:"Not admin"});req.user=u;next();}catch{return res.status(401).json({error:"Invalid"});}
}

app.get('/api/config/status',(req,res)=>{res.json({emailConfigured:emailReady, mode: emailReady?'LIVE':'DEV'});});

app.post('/api/upload', auth, upload.single('image'), (req,res)=>{
  if(!req.file) return res.status(400).json({error:"No file uploaded"});
  const url=`/uploads/${req.file.filename}`;
  res.json({success:true, url});
});

// OTP
const otpAttempts=new Map();
app.post('/api/otp/send', async (req,res)=>{
  const {email,phone,purpose}=req.body;
  if(!email) return res.status(400).json({error:"Email required"});
  const key=email.toLowerCase(); const now=Date.now();
  let attempts=otpAttempts.get(key)||[]; attempts=attempts.filter(t=>now-t < 5*60*1000);
  if(attempts.length>=5) return res.status(429).json({error:"Too many requests. Wait 5 minutes."});
  attempts.push(now); otpAttempts.set(key,attempts);
  const code=genOTP();
  const db=readDB();
  db.otps=db.otps.filter(o=>now-o.createdAt < 5*60*1000);
  db.otps=db.otps.filter(o=> !(o.email===email.toLowerCase() && o.purpose===(purpose||'signup')));
  db.otps.push({email:email.toLowerCase(),phone,code,verified:false,createdAt:now,expiresAt:now+5*60*1000,purpose:purpose||'signup'});
  writeDB(db); console.log(`[OTP ${purpose||'signup'}] ${email} -> ${code}`);
  let emailSent=false;
  if(transporter && emailReady){
    const isReset=(purpose==='reset');
    const subject=isReset?`${code} - Reset your MarketHub password`:`${code} - Your MarketHub verification code`;
    const html=`<div style="font-family:Arial;max-width:480px;margin:auto;border:1px solid #e5e7eb;border-radius:16px;padding:24px"><h2 style="margin:0 0 8px">${isReset?'Reset your password':'Verify your email'}</h2><p style="color:#52525b;font-size:14px">Your code is below. Valid 5 minutes.</p><div style="margin:20px 0;background:#f4f4f5;border-radius:12px;padding:16px;text-align:center"><span style="font-size:30px;font-weight:900;letter-spacing:6px">${code}</span></div></div>`;
    const r=await sendMail(email, subject, `Your code: ${code} Valid 5 min`, html); emailSent=r.sent;
  }
  res.json({success:true,emailSent,emailConfigured:emailReady,devCode: emailSent? null : code, message: emailSent?`Code sent to ${email}. Check inbox and spam.`:`Code generated.`,expiresIn:300});
});

app.post('/api/otp/verify',(req,res)=>{
  const {email,phone,code,purpose}=req.body;
  if(!code) return res.status(400).json({error:"Code required"});
  const db=readDB();
  const otp=db.otps.find(o=>(o.email===email?.toLowerCase() || o.phone===phone) && o.code===code && o.purpose===(purpose||'signup'));
  if(!otp) return res.status(400).json({error:"Invalid code. Check and try again."});
  if(Date.now()>otp.expiresAt){ db.otps=db.otps.filter(o=>o!==otp); writeDB(db); return res.status(400).json({error:"Code expired. Request new one."}); }
  otp.verified=true; writeDB(db); res.json({success:true});
});

app.post('/api/auth/forgot-password', async (req,res)=>{
  const {email}=req.body; if(!email) return res.status(400).json({error:"Email required"});
  const db=readDB(); const user=db.users.find(u=>u.email.toLowerCase()===email.toLowerCase());
  if(!user) return res.status(400).json({error:"No account found"});
  const code=genOTP(); const now=Date.now();
  db.otps=db.otps.filter(o=>now-o.createdAt < 5*60*1000);
  db.otps.push({email:email.toLowerCase(),code,verified:false,createdAt:now,expiresAt:now+5*60*1000,purpose:'reset'});
  writeDB(db); let sent=false;
  if(transporter && emailReady){
    const html=`<div style="font-family:Arial;max-width:480px;margin:auto;border:1px solid #eee;border-radius:16px;padding:24px"><h2>Password reset</h2><p>Code: <b style="font-size:26px;letter-spacing:5px">${code}</b></p><p>Valid 5 minutes.</p></div>`;
    const r=await sendMail(email, `${code} - Reset password`, `Reset code: ${code}`, html); sent=r.sent;
  }
  res.json({success:true,emailSent:sent,devCode: sent? null : code});
});

app.post('/api/auth/reset-password', async (req,res)=>{
  const {email,code,newPassword}=req.body;
  if(!email||!code||!newPassword) return res.status(400).json({error:"All fields required"});
  if(newPassword.length<6) return res.status(400).json({error:"Password min 6 chars"});
  const db=readDB(); const otp=db.otps.find(o=>o.email===email.toLowerCase() && o.code===code && o.purpose==='reset');
  if(!otp) return res.status(400).json({error:"Invalid reset code"});
  if(Date.now()>otp.expiresAt) return res.status(400).json({error:"Code expired"});
  const user=db.users.find(u=>u.email.toLowerCase()===email.toLowerCase());
  if(!user) return res.status(400).json({error:"User not found"});
  user.password=await bcrypt.hash(newPassword,12);
  db.otps=db.otps.filter(o=>o!==otp); writeDB(db);
  addLog("PASSWORD_RESET",`${user.username} reset password`);
  res.json({success:true,message:"Password changed. Login now."});
});

app.post('/api/signup', async (req,res)=>{
  const {username,email,phone,password,role,otpCode}=req.body;
  if(!username||!email||!password||!role) return res.status(400).json({error:"Fill all required fields"});
  const db=readDB();
  if(db.users.find(u=>u.email.toLowerCase()===email.toLowerCase())) return res.status(400).json({error:"Email already registered. Please sign in instead."});
  const otp=db.otps.find(o=>o.email===email.toLowerCase() && o.code===otpCode && o.verified && o.purpose==='signup');
  if(!otp) return res.status(400).json({error:"Please verify your email first. Enter the 6-digit code."});
  if(password.length<6) return res.status(400).json({error:"Password must be at least 6 characters"});
  const hashed=await bcrypt.hash(password,12);
  const user={id:'u_'+Date.now(),username,email:email.toLowerCase(),phone:phone||'',password:hashed,role,isEmailVerified:true,isPhoneVerified:!!phone,reportCount:0,deliveredCount:0,isVerifiedSeller:false,createdAt:new Date().toISOString()};
  db.users.push(user); writeDB(db); addLog("NEW_USER",`${username} (${role})`);
  if(transporter && emailReady){
    const html=`<div style="font-family:Arial;max-width:520px;margin:auto;border:1px solid #e5e7eb;border-radius:20px;overflow:hidden"><div style="background:#000;color:#fff;padding:24px"><h2 style="margin:0">Welcome to MarketHub, ${username}!</h2></div><div style="padding:24px"><p>Your ${role} account is ready.</p></div></div>`;
    await sendMail(user.email, `Welcome to MarketHub, ${username}!`, `Welcome ${username}!`, html);
  }
  const token=jwt.sign({id:user.id,email:user.email,role:user.role,username:user.username},JWT_SECRET,{expiresIn:'7d'});
  res.json({token,user:{id:user.id,username,email:user.email,phone:user.phone,role:user.role,isVerifiedSeller:false}});
});

app.post('/api/login', async (req,res)=>{
  const {email,password}=req.body;
  const db=readDB(); const user=db.users.find(u=>u.email.toLowerCase()===email.toLowerCase());
  if(!user) return res.status(400).json({error:"Account not found"});
  const susp=isUserSuspended(user);
  if(susp.suspended){
    if(susp.permanent) return res.status(403).json({error:`Your account has been permanently banned. Reason: ${susp.reason||'Violation of terms'}. Contact support.`});
    else return res.status(403).json({error:`Your account is suspended for ${susp.daysLeft} more day(s) until ${new Date(susp.until).toLocaleDateString()}. Reason: ${susp.reason||''}`});
  }
  const ok=await bcrypt.compare(password,user.password);
  if(!ok) return res.status(400).json({error:"Incorrect password"});
  const token=jwt.sign({id:user.id,email:user.email,role:user.role,username:user.username},JWT_SECRET,{expiresIn:'7d'});
  addLog("LOGIN",`${user.username}`); res.json({token,user:{id:user.id,username:user.username,email:user.email,phone:user.phone,role:user.role,reportCount:user.reportCount,deliveredCount:user.deliveredCount,isVerifiedSeller:user.isVerifiedSeller}});
});

app.get('/api/products',(req,res)=>{
  let {search,type}=req.query; const db=readDB(); let products=db.products;
  if(type && type!=='all') products=products.filter(p=>p.type===type);
  if(search){const q=search.toLowerCase(); products=products.filter(p=>p.name.toLowerCase().includes(q)||p.description.toLowerCase().includes(q)||p.category.toLowerCase().includes(q));}
  res.json(products.reverse());
});
app.post('/api/products',auth,(req,res)=>{
  if(req.user.role!=='seller' && req.user.role!=='admin') return res.status(403).json({error:"Only sellers can list"});
  const {name,description,price,image,category,type,stock}=req.body;
  if(!name||!price) return res.status(400).json({error:"Name and price required"});
  const allowed=['hardware','software','document','tool','general']; const pType=allowed.includes(type)?type:'general';
  const db=readDB(); const seller=db.users.find(u=>u.id===req.user.id);
  const product={id:'p_'+Date.now(),sellerId:req.user.id,sellerName:req.user.username,sellerVerified:!!seller?.isVerifiedSeller,sellerReportCount:seller?.reportCount||0,name,description:description||'',price:Number(price),image:image||`https://picsum.photos/seed/${Date.now()}/400/300`,category:category||'General',type:pType,stock:Number(stock)||1,createdAt:new Date().toISOString()};
  db.products.push(product); writeDB(db); addLog("NEW_PRODUCT",`${req.user.username} listed ${name}`); io.emit('new_product',product); res.json(product);
});
app.delete('/api/products/:id',auth,(req,res)=>{const db=readDB(); const idx=db.products.findIndex(p=>p.id===req.params.id); if(idx===-1) return res.status(404).json({error:"Not found"}); if(db.products[idx].sellerId!==req.user.id && req.user.role!=='admin') return res.status(403).json({error:"Not yours"}); db.products.splice(idx,1); writeDB(db); res.json({success:true});});

app.post('/api/orders',auth, async (req,res)=>{
  if(req.user.role!=='buyer' && req.user.role!=='admin') return res.status(403).json({error:"Only buyers"});
  const {productId,message,phone,deliveryAddress}=req.body;
  if(!phone || phone.length<7) return res.status(400).json({error:"Phone number required"});
  const db=readDB(); const product=db.products.find(p=>p.id===productId);
  if(!product) return res.status(404).json({error:"Product not found"});
  if(product.type==='hardware' && (!deliveryAddress || deliveryAddress.length<5)) return res.status(400).json({error:"Delivery address required for hardware"});
  const order={id:'o_'+Date.now(),code:genOrderCode(),productId,productName:product.name,productImage:product.image,productType:product.type,price:product.price,buyerId:req.user.id,buyerName:req.user.username,buyerEmail:req.user.email,buyerPhone:phone,deliveryAddress:deliveryAddress||'',sellerId:product.sellerId,sellerName:product.sellerName,message:message||'',status:'pending',createdAt:new Date().toISOString()};
  db.orders.push(order); writeDB(db); addLog("NEW_ORDER",`${order.code} - ${req.user.username} -> ${product.name}`);
  const buyer=db.users.find(u=>u.id===req.user.id); const seller=db.users.find(u=>u.id===product.sellerId);
  if(buyer && seller && transporter && emailReady){
    const sellerHtml=`<div style="font-family:Arial;max-width:520px;margin:auto;border:1px solid #e5e7eb;border-radius:20px;overflow:hidden"><div style="background:#000;color:#fff;padding:20px"><h2 style="margin:0">New order ${order.code}</h2></div><div style="padding:20px"><p><b>${product.name}</b> - $${product.price}</p><p>Buyer: ${buyer.username} (${buyer.email})<br>Phone: ${order.buyerPhone}</p>${order.deliveryAddress?`<p>Delivery: ${order.deliveryAddress}</p>`:''}</div></div>`;
    await sendMail(seller.email, `New order ${order.code} - ${product.name}`, `New order ${order.code}`, sellerHtml);
    const buyerHtml=`<div style="font-family:Arial;max-width:520px;margin:auto;border:1px solid #e5e7eb;border-radius:20px;overflow:hidden"><div style="background:#000;color:#fff;padding:20px"><h2 style="margin:0">Order confirmed ${order.code}</h2></div><div style="padding:20px"><p>Hi ${buyer.username}, your order for <b>${product.name}</b> sent to ${seller.username}.</p><p>Order code: <b>${order.code}</b></p></div></div>`;
    await sendMail(buyer.email, `Order ${order.code} confirmed`, `Order ${order.code}`, buyerHtml);
  }
  io.to(`user_${product.sellerId}`).emit('new_order',order);
  io.to('admins').emit('new_order',order);
  res.json(order);
});
app.get('/api/orders/buyer',auth,(req,res)=>{res.json(readDB().orders.filter(o=>o.buyerId===req.user.id).reverse());});
app.get('/api/orders/seller',auth,(req,res)=>{res.json(readDB().orders.filter(o=>o.sellerId===req.user.id).reverse());});
app.get('/api/orders/search',auth,(req,res)=>{const {code}=req.query; if(!code) return res.json([]); const db=readDB(); let orders=db.orders.filter(o=>o.code.toLowerCase().includes(code.toLowerCase())); if(req.user.role!=='admin') orders=orders.filter(o=>o.buyerId===req.user.id || o.sellerId===req.user.id); res.json(orders.reverse());});
app.put('/api/orders/:id/status',auth, async (req,res)=>{
  const {status}=req.body; const db=readDB(); const order=db.orders.find(o=>o.id===req.params.id);
  if(!order) return res.status(404).json({error:"Not found"});
  if(order.sellerId!==req.user.id && order.buyerId!==req.user.id && req.user.role!=='admin') return res.status(403).json({error:"Not yours"});
  order.status=status;
  if(status==='delivered' || status==='confirmed'){ const seller=db.users.find(u=>u.id===order.sellerId); if(seller){ seller.deliveredCount=(seller.deliveredCount||0)+1; if(seller.deliveredCount>=50) seller.isVerifiedSeller=true; } }
  writeDB(db);
  if(transporter && emailReady){
    const buyer=db.users.find(u=>u.id===order.buyerId);
    if(buyer) await sendMail(buyer.email, `Order ${order.code} is now ${status}`, `Status: ${status}`, `<p>Order ${order.code} is now ${status}</p>`);
  }
  io.to(`user_${order.buyerId}`).emit('order_update',order);
  io.to(`user_${order.sellerId}`).emit('order_update',order);
  io.to('admins').emit('order_update',order);
  res.json(order);
});

app.post('/api/reports',auth,(req,res)=>{
  const {sellerId,productId,reason}=req.body;
  if(!sellerId||!reason) return res.status(400).json({error:"Reason required"});
  const db=readDB(); const seller=db.users.find(u=>u.id===sellerId);
  if(!seller) return res.status(404).json({error:"Seller not found"});
  const report={id:'r_'+Date.now(),reporterId:req.user.id,reporterName:req.user.username,sellerId,productId:productId||null,reason,createdAt:new Date().toISOString()};
  db.reports.push(report); seller.reportCount=(seller.reportCount||0)+1; writeDB(db);
  addLog("REPORT",`${req.user.username} reported ${seller.username}`); io.to('admins').emit('new_report',report);
  res.json({success:true,reportCount:seller.reportCount});
});

// Admin with suspend/unban
app.get('/api/admin/stats',adminAuth,(req,res)=>{
  const db=readDB(); res.json({totalUsers:db.users.length,totalBuyers:db.users.filter(u=>u.role==='buyer').length,totalSellers:db.users.filter(u=>u.role==='seller').length,totalProducts:db.products.length,totalOrders:db.orders.length,pendingOrders:db.orders.filter(o=>o.status==='pending').length,totalReports:db.reports.length,flaggedSellers:db.users.filter(u=>u.reportCount>=15),logs:db.logs.slice(0,100),emailReady});
});
app.get('/api/admin/users',adminAuth,(req,res)=>{ 
  const db=readDB();
  const users=db.users.map(u=>{
    const s=isUserSuspended(u);
    return {...u, suspensionStatus: s.suspended ? (s.permanent?'BANNED':`SUSPENDED ${s.daysLeft}d left until ${new Date(s.until).toLocaleDateString()}`) : 'ACTIVE', isSuspended: s.suspended, isPermBanned: s.permanent, suspendedUntil: u.suspendedUntil||null};
  });
  res.json(users);
});
app.get('/api/admin/reports',adminAuth,(req,res)=> res.json(readDB().reports.reverse()));
app.get('/api/admin/all-orders',adminAuth,(req,res)=> res.json(readDB().orders.reverse()));
app.delete('/api/admin/users/:id',adminAuth,(req,res)=>{const db=readDB(); db.users=db.users.filter(u=>u.id!==req.params.id); writeDB(db); res.json({success:true});});

app.post('/api/admin/ban/:id',adminAuth,(req,res)=>{
  const {reason}=req.body; const db=readDB(); const u=db.users.find(x=>x.id===req.params.id); if(!u) return res.status(404).json({error:"Not found"});
  u.banned=true; u.banReason=reason||'Banned by admin'; u.suspendedUntil=null; writeDB(db); addLog("BAN",`Banned ${u.username} Reason:${reason||''}`); res.json({success:true});
});
app.post('/api/admin/suspend/:id',adminAuth,(req,res)=>{
  const {days, reason}=req.body; const db=readDB(); const u=db.users.find(x=>x.id===req.params.id); if(!u) return res.status(404).json({error:"Not found"});
  const d=Number(days)||1;
  u.banned=false; u.suspendedUntil=Date.now() + d*24*60*60*1000; u.suspensionReason=reason||`Suspended for ${d} day(s)`; u.suspensionDays=d;
  writeDB(db); addLog("SUSPEND",`Suspended ${u.username} for ${d} days Reason:${reason||''}`); res.json({success:true, suspendedUntil:u.suspendedUntil});
});
app.post('/api/admin/unban/:id',adminAuth,(req,res)=>{
  const db=readDB(); const u=db.users.find(x=>x.id===req.params.id); if(!u) return res.status(404).json({error:"Not found"});
  u.banned=false; u.suspendedUntil=null; u.suspensionReason=null; u.banReason=null; writeDB(db); addLog("UNBAN",`Unbanned ${u.username}`); res.json({success:true});
});

io.use((socket,next)=>{const t=socket.handshake.auth.token; if(!t) return next(); try{socket.user=jwt.verify(t,JWT_SECRET); next();}catch{next();}});
io.on('connection',(socket)=>{if(socket.user){socket.join(`user_${socket.user.id}`); if(socket.user.role==='seller') socket.join('sellers'); if(socket.user.role==='admin') socket.join('admins');}});

app.get('*',(req,res)=> res.sendFile(path.join(__dirname,'public','index.html')));
server.listen(PORT,'0.0.0.0',()=>{console.log(`\n✅ MarketHub V14 BREVO+SMTP FIX LIVE at http://localhost:${PORT}`); console.log(`📧 Mail: ${emailReady?'READY':'DEV MODE'} | 📸 Upload 5MB | 🔨 Ban/Suspend/Unban ready\n`);});
