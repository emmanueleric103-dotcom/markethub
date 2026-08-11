
const express=require('express');
const fs=require('fs');
const path=require('path');
const jwt=require('jsonwebtoken');
const bcrypt=require('bcryptjs');
const multer=require('multer');
const rateLimit=require('express-rate-limit');
const nodemailer=require('nodemailer');

const app=express();
app.set('trust proxy',1);
const PORT=process.env.PORT||3000;
const JWT_SECRET=process.env.JWT_SECRET||'dev_secret_change_me_32_chars_long';
const ADMIN_SECRET=process.env.ADMIN_SECRET||'admin_secret_123';
const ADMIN_EMAIL=process.env.ADMIN_EMAIL||'owner@markethub.com';
const ADMIN_PASSWORD=process.env.ADMIN_PASSWORD||'OwnerStrongPass123';

const DB_PATH=path.join(__dirname,'data','db.json');
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
const brevoSender=(process.env.BREVO_SENDER||smtpUser||'no-reply@markethub.com').trim();
const resendKey=(process.env.RESEND_API_KEY||'').trim();

console.log('=== EMAIL DEBUG ===');
console.log('SMTP HOST:', smtpHost, 'PORT:', smtpPort);
console.log('SMTP USER:', smtpUser ? smtpUser.slice(0,3)+'***@'+(smtpUser.split('@')[1]||'') : 'MISSING');
console.log('SMTP PASS len:', smtpPass.length);
console.log('BREVO KEY present:', !!brevoKey, 'len', brevoKey.length);
console.log('BREVO SENDER:', brevoSender);
console.log('RESEND KEY present:', !!resendKey);
console.log('===================');

const emailConfigured = !!(brevoKey || resendKey || (smtpUser && smtpPass));

const transporter = (smtpUser && smtpPass) ? nodemailer.createTransport({
  host: smtpHost, port: smtpPort, secure: smtpPort===465,
  auth:{user:smtpUser,pass:smtpPass},
  connectionTimeout:8000, socketTimeout:8000, tls:{rejectUnauthorized:false}
}) : null;

async function sendEmailViaBrevo(to, subject, html){
  if(!brevoKey) return false;
  try{
    const res = await fetch('https://api.brevo.com/v3/smtp/email',{
      method:'POST',
      headers:{'accept':'application/json','api-key':brevoKey,'content-type':'application/json'},
      body: JSON.stringify({sender:{name:process.env.MAIL_FROM_NAME||'MarketHub', email:brevoSender}, to:[{email:to}], subject, htmlContent: html})
    });
    const data = await res.json();
    if(!res.ok){ console.error('Brevo API error:', res.status, JSON.stringify(data).slice(0,500)); return false; }
    console.log('Brevo sent to', to, 'id:', data.messageId);
    return true;
  }catch(e){ console.error('Brevo failed:', e.message); return false; }
}

async function sendEmail(to, subject, code, type){
  const html = `<div style="font-family:Arial;padding:20px;max-width:600px"><h2>MarketHub - ${type} Code</h2><p>Your code:</p><h1 style="letter-spacing:8px;background:#f5f5f5;padding:15px;text-align:center">${code}</h1><p>Valid 10 min.</p></div>`;
  if(brevoKey){ const ok=await sendEmailViaBrevo(to, subject, html); if(ok) return true; }
  if(transporter){
    try{ await transporter.sendMail({from:`"${process.env.MAIL_FROM_NAME||'MarketHub'}" <${smtpUser}>`, to, subject, html}); console.log('SMTP sent to', to); return true; }catch(e){ console.error('SMTP failed:', e.message); }
  }
  console.log(`[OTP fallback] ${to} -> ${code}`);
  return false;
}

function readDB(){ try{ return JSON.parse(fs.readFileSync(DB_PATH,'utf8')); }catch{ return {users:[],products:[],orders:[],reports:[],otps:[],logs:[]}; } }
function writeDB(d){ try{ const dir=path.dirname(DB_PATH); if(!fs.existsSync(dir)) fs.mkdirSync(dir,{recursive:true}); fs.writeFileSync(DB_PATH,JSON.stringify(d,null,2)); }catch(e){ console.error('writeDB error', e.message); } }

app.use(express.json({limit:'10mb'}));
app.use(express.static(path.join(__dirname,'public')));
app.use('/uploads', express.static(path.join(__dirname,'public','uploads')));

const limiter=rateLimit({windowMs:15*60*1000, max:200, standardHeaders:true, legacyHeaders:false});

app.post('/api/send-otp', limiter, async (req,res)=>{
  try{
    const {email, type='signup'} = req.body;
    if(!email) return res.status(400).json({error:'Email required'});
    const code=Math.floor(100000+Math.random()*900000).toString();
    const db=readDB();
    db.otps=db.otps.filter(o=>o.email!==email);
    db.otps.push({email, code, type, expires: Date.now()+10*60*1000});
    writeDB(db);
    console.log(`[OTP ${type}] ${email} -> ${code}`);
    let sent=false;
    try{ sent=await sendEmail(email, `MarketHub ${type} code`, code, type); }catch(e){ console.error('sendEmail error', e.message); }
    res.json({ok:true, sent, devCode: !sent ? code : undefined});
  }catch(e){ console.error(e); res.status(500).json({error:'OTP failed'}); }
});

app.post('/api/verify-otp', (req,res)=>{
  try{
    const {email, code, type} = req.body;
    const db=readDB();
    const otp=db.otps.find(o=>o.email===email && o.code===code && o.type===type);
    if(!otp) return res.status(400).json({error:'Invalid code'});
    if(Date.now()>otp.expires) return res.status(400).json({error:'Code expired'});
    db.otps=db.otps.filter(o=>o.email!==email);
    writeDB(db);
    res.json({ok:true});
  }catch(e){ res.status(500).json({error:'Verify failed'}); }
});

app.post('/api/signup', async (req,res)=>{
  try{
    const {email,password,name,code} = req.body;
    const db=readDB();
    if(db.users.find(u=>u.email===email)) return res.status(400).json({error:'User exists'});
    const otp=db.otps.find(o=>o.email===email && o.code===code && o.type==='signup');
    if(!otp) return res.status(400).json({error:'Invalid OTP, request new code'});
    if(Date.now()>otp.expires) return res.status(400).json({error:'OTP expired'});
    const hash=await bcrypt.hash(password,10);
    const user={id:Date.now().toString(), email, password:hash, name, role:'user', created:Date.now(), banned:false};
    db.users.push(user);
    db.otps=db.otps.filter(o=>o.email!==email);
    writeDB(db);
    const token=jwt.sign({id:user.id,email:user.email,role:user.role}, JWT_SECRET, {expiresIn:'7d'});
    res.json({ok:true, token, user:{id:user.id,email:user.email,name:user.name,role:user.role}});
  }catch(e){ console.error(e); res.status(500).json({error:'Signup failed'}); }
});

app.post('/api/login', async (req,res)=>{
  try{
    const {email,password}=req.body;
    const db=readDB();
    const user=db.users.find(u=>u.email===email);
    if(!user) return res.status(400).json({error:'User not found'});
    if(user.banned) return res.status(403).json({error:'Account banned'});
    const ok=await bcrypt.compare(password, user.password);
    if(!ok) return res.status(400).json({error:'Wrong password'});
    const token=jwt.sign({id:user.id,email:user.email,role:user.role}, JWT_SECRET, {expiresIn:'7d'});
    res.json({ok:true, token, user:{id:user.id,email:user.email,name:user.name,role:user.role}});
  }catch(e){ res.status(500).json({error:'Login failed'}); }
});

function auth(req,res,next){
  const h=req.headers.authorization;
  if(!h) return res.status(401).json({error:'No token'});
  try{ req.user=jwt.verify(h.split(' ')[1], JWT_SECRET); next(); }catch{ return res.status(401).json({error:'Invalid token'}); }
}

app.get('/api/me', auth, (req,res)=>{
  const db=readDB();
  const user=db.users.find(u=>u.id===req.user.id);
  if(!user) return res.status(404).json({error:'Not found'});
  res.json({id:user.id,email:user.email,name:user.name,role:user.role});
});

app.get('/api/products', (req,res)=>{
  const db=readDB();
  res.json(db.products||[]);
});

app.post('/api/products', auth, multer({dest:'public/uploads/', limits:{fileSize:5*1024*1024}}).single('image'), (req,res)=>{
  try{
    const db=readDB();
    const {title,price,description} = req.body;
    const product={id:Date.now().toString(), title, price: parseFloat(price), description, image: req.file?`/uploads/${req.file.filename}`:'', owner:req.user.id, created:Date.now()};
    db.products.push(product);
    writeDB(db);
    res.json({ok:true, product});
  }catch(e){ res.status(500).json({error:'Create failed'}); }
});

app.get('/api/admin/stats', (req,res)=>{
  const secret=req.headers['x-admin-secret'];
  if(secret!==ADMIN_SECRET) return res.status(403).json({error:'Forbidden'});
  const db=readDB();
  res.json({users:db.users.length, products:db.products.length, orders:db.orders.length});
});

app.get('*', (req,res)=> res.sendFile(path.join(__dirname,'public','index.html')));

app.listen(PORT, ()=> {
  console.log(`✅ MarketHub V15 BREVO FORCE LIVE at http://localhost:${PORT}`);
  console.log(`📧 Mail: ${emailConfigured ? (brevoKey ? 'READY (Brevo) '+brevoSender : 'READY '+smtpUser) : 'DEV MODE'} | 📦 Upload 5MB | 🔨 Ban/Suspend/Unban ready`);
  console.log(`Admin: ${ADMIN_EMAIL}`);
});
