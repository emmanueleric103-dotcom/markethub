
let token=localStorage.getItem('token'), currentUser=JSON.parse(localStorage.getItem('user')||'null'), socket=null, currentFilter='all', pendingProduct=null;
let otpTimer=null, otpSeconds=0, fTimer=null, fSeconds=0;
let isEmailVerified=false, currentEmailForOTP='';

function showTab(t){
 document.getElementById('loginTab').classList.toggle('hidden', t!=='login');
 document.getElementById('signupTab').classList.toggle('hidden', t!=='signup');
 document.getElementById('tabLogin').className = t==='login' ? 'px-5 py-2.5 rounded-full bg-zinc-900 text-white text-[13px] font-semibold' : 'px-5 py-2.5 rounded-full text-[13px] font-semibold text-zinc-600';
 document.getElementById('tabSignup').className = t==='signup' ? 'px-5 py-2.5 rounded-full bg-zinc-900 text-white text-[13px] font-semibold' : 'px-5 py-2.5 rounded-full text-[13px] font-semibold text-zinc-600';
}
function updateUI(){
 const authBox=document.getElementById('authBox');
 const mainApp=document.getElementById('mainApp');
 if(!token||!currentUser){
   authBox.classList.remove('hidden');
   authBox.style.display='grid';
   mainApp.classList.add('hidden');
   mainApp.style.display='none';
   return;
 }
 authBox.classList.add('hidden');
 authBox.style.display='none';
 mainApp.classList.remove('hidden');
 mainApp.style.display='block';
 document.getElementById('userInfo').innerText=currentUser.username+(currentUser.isVerifiedSeller?' ✓':'' );
 document.getElementById('logoutBtn').classList.remove('hidden');
 document.getElementById('welcome').innerText=`Welcome back, ${currentUser.username}`;
 if(currentUser.role==='buyer'){ document.getElementById('buyerSection').classList.remove('hidden'); document.getElementById('sellerSection').classList.add('hidden'); loadProducts(); loadBuyerOrders(); }
 else { document.getElementById('buyerSection').classList.add('hidden'); document.getElementById('sellerSection').classList.remove('hidden'); loadProducts(true); loadSellerOrders(); if(currentUser.deliveredCount>=50||currentUser.isVerifiedSeller) document.getElementById('sellerVerifiedBadge').classList.remove('hidden'); }
 connectSocket();
}
document.getElementById('logoutBtn').onclick=()=>{localStorage.clear(); location.reload();};

// Image upload handler
document.getElementById('p_file')?.addEventListener('change', async (e)=>{
  const file=e.target.files[0];
  if(!file) return;
  if(file.size>5*1024*1024) return alert('Image must be less than 5MB');
  const status=document.getElementById('uploadStatus');
  status.innerText='Uploading...';
  const fd=new FormData(); fd.append('image',file);
  try{
    let r=await fetch('/api/upload',{method:'POST',headers:{'Authorization':'Bearer '+token},body:fd});
    let d=await r.json();
    if(d.error) { status.innerText='❌ '+d.error; return; }
    document.getElementById('p_image').value=d.url;
    const img=document.getElementById('imgPrev'); img.src=d.url; img.classList.remove('hidden');
    status.innerText='✅ Uploaded - '+d.url;
  }catch{ status.innerText='Upload failed - try again'; }
});

function previewImage(url){
 const img=document.getElementById('imgPrev');
 if(!url){ img.classList.add('hidden'); return; }
 img.src=url; img.classList.remove('hidden');
 img.onerror=()=>{ img.src='https://picsum.photos/seed/fallback/400/300'; };
}

async function sendOTP(purpose='signup'){
 const email=document.getElementById('s_email').value.trim();
 if(!email) return showAuthMsg('Please enter your email address first','error');
 const phone=document.getElementById('s_phone').value.trim();
 const btn=document.getElementById('sendBtn');
 btn.disabled=true; const originalText=btn.innerText; btn.innerText='Sending...';
 currentEmailForOTP=email; isEmailVerified=false; updateSignupButton();
 showAuthMsg('Sending verification code to your email...','info');
 try{
   let r=await fetch('/api/otp/send',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,phone,purpose})});
   let d=await r.json();
   if(!r.ok){ showAuthMsg(d.error||'Failed to send code','error'); btn.disabled=false; btn.innerText=originalText; return; }
   const code=d.devCode;
   // Dev mode: show code
   if(code){
     document.getElementById('otpDisplay').classList.remove('hidden');
     document.getElementById('otpBig').innerText=code;
     document.getElementById('otpHint').innerText='Testing mode: code shown here. In production with real Gmail, this is hidden.';
     document.getElementById('s_otp').value=code;
     // auto verify for dev
     setTimeout(()=>autoVerifyOTP(email,code,purpose),500);
   } else {
     document.getElementById('otpDisplay').classList.add('hidden');
     document.getElementById('s_otp').value='';
     document.getElementById('s_otp').placeholder='Enter code from your email';
     document.getElementById('s_otp').focus();
   }
   if(d.emailSent){
     showAuthMsg(`Code sent to ${email}. Please check your inbox and spam folder. It expires in 5 minutes.`,'success');
   } else if(!code){
     showAuthMsg(`Code sent. Check console for testing. To send real email, configure SMTP in .env`,'info');
   } else {
     showAuthMsg(`Code generated for testing. In production it will be emailed.`,'info');
   }
   // start countdown - FIXED to not show "Code: null"
   otpSeconds=d.expiresIn||300; if(otpTimer) clearInterval(otpTimer);
   document.getElementById('countdownBox').classList.remove('hidden');
   const total=otpSeconds;
   function tick(){
     const m=Math.floor(otpSeconds/60), s=otpSeconds%60;
     document.getElementById('countdownText').innerText=`Code expires in ${m}:${s.toString().padStart(2,'0')}`;
     const pb=document.getElementById('progressBar'); if(pb) pb.style.width=(otpSeconds/total*100)+'%';
     btn.innerText=`Resend in ${m}:${s.toString().padStart(2,'0')}`;
     otpSeconds--;
     if(otpSeconds<0){
       clearInterval(otpTimer);
       document.getElementById('countdownBox').innerHTML=`<span>Code expired</span><button onclick="sendOTP('signup')" class="ml-2 px-3 py-1 bg-white text-zinc-900 rounded-full text-[11px] font-bold">Send new code</button>`;
       btn.disabled=false; btn.innerText='Send new code';
     }
   }
   tick(); otpTimer=setInterval(tick,1000);
 }catch(e){
   showAuthMsg('Network error. Please check your connection and try again.','error');
   btn.disabled=false; btn.innerText=originalText;
 }
}

function showAuthMsg(msg,type){
 const el=document.getElementById('authMsg');
 el.innerText=msg;
 el.className='mt-4 text-[13px] font-medium '+(type==='error'?'text-red-600':type==='success'?'text-green-700':'text-zinc-600');
}

// Auto verify when 6 digits entered
document.getElementById('s_otp')?.addEventListener('input', (e)=>{
  let val=e.target.value.replace(/\D/g,'').slice(0,6);
  e.target.value=val;
  if(val.length===6 && currentEmailForOTP){
    autoVerifyOTP(currentEmailForOTP, val, 'signup');
  } else {
    isEmailVerified=false; updateSignupButton();
    document.getElementById('otpCheck').classList.add('hidden');
    document.getElementById('otpVerifiedMsg').classList.add('hidden');
  }
});

async function autoVerifyOTP(email, code, purpose='signup'){
  if(!email || !code || code.length!==6) return;
  try{
    let r=await fetch('/api/otp/verify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,code,purpose})});
    let d=await r.json();
    if(r.ok && d.success){
      isEmailVerified=true;
      document.getElementById('otpCheck').classList.remove('hidden');
      document.getElementById('otpVerifiedMsg').classList.remove('hidden');
      document.getElementById('otpVerifiedMsg').innerText='✓ Email verified — you can create your account now';
      showAuthMsg('Email verified successfully. You can now create your account.','success');
      updateSignupButton();
      if(otpTimer){ clearInterval(otpTimer); document.getElementById('countdownBox').classList.add('hidden'); document.getElementById('sendBtn').innerText='Verified ✓'; document.getElementById('sendBtn').disabled=true; document.getElementById('sendBtn').classList.add('bg-green-600'); }
    } else {
      isEmailVerified=false; updateSignupButton();
      if(code.length===6) showAuthMsg(d.error||'Invalid code','error');
    }
  }catch{}
}

function updateSignupButton(){
  const btn=document.getElementById('signupBtn');
  if(isEmailVerified){ btn.classList.remove('opacity-50','pointer-events-none'); btn.classList.add('bg-zinc-900'); }
  else { btn.classList.add('opacity-50','pointer-events-none'); }
}

async function signup(){
 const username=document.getElementById('s_name').value.trim(), email=document.getElementById('s_email').value.trim(), phone=document.getElementById('s_phone').value.trim(), password=document.getElementById('s_pass').value, role=document.getElementById('s_role').value, otpCode=document.getElementById('s_otp').value.trim();
 if(!username||!email||!password) return showAuthMsg('Please fill all required fields','error');
 if(!isEmailVerified){
   // try verify one more time
   if(otpCode.length===6){
     await autoVerifyOTP(email, otpCode, 'signup');
     if(!isEmailVerified) return showAuthMsg('Please verify your email first. Enter the 6-digit code sent to your email.','error');
   } else {
     return showAuthMsg('Please verify your email first. Click Send code and enter the code.','error');
   }
 }
 let r=await fetch('/api/signup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,email,phone,password,role,otpCode})});
 let d=await r.json(); if(d.error) return showAuthMsg(d.error,'error');
 token=d.token; currentUser=d.user; localStorage.setItem('token',token); localStorage.setItem('user',JSON.stringify(currentUser));
 notify('Account created successfully');
 updateUI();
 window.scrollTo({top:0,behavior:'smooth'});
 // clear signup form
 document.getElementById('s_name').value=''; document.getElementById('s_email').value=''; document.getElementById('s_phone').value=''; document.getElementById('s_pass').value=''; document.getElementById('s_otp').value='';
 isEmailVerified=false;

}
async function login(){
 let r=await fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:document.getElementById('l_email').value,password:document.getElementById('l_pass').value})});
 let d=await r.json(); if(d.error) return showAuthMsg(d.error,'error');
 token=d.token; currentUser=d.user; localStorage.setItem('token',token); localStorage.setItem('user',JSON.stringify(currentUser)); updateUI(); window.scrollTo({top:0,behavior:'smooth'});
}

function openForgotModal(){ document.getElementById('forgotModal').classList.remove('hidden'); }
function closeForgotModal(){ document.getElementById('forgotModal').classList.add('hidden'); }
async function sendForgotCode(){
 const email=document.getElementById('f_email').value.trim();
 if(!email) return alert('Enter email');
 const btn=document.getElementById('f_sendBtn'); btn.disabled=true; btn.innerText='Sending...';
 document.getElementById('f_msg').innerText='Sending reset code...';
 try{
   let r=await fetch('/api/auth/forgot-password',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email})});
   let d=await r.json();
   if(!r.ok){ document.getElementById('f_msg').innerText='❌ '+d.error; btn.disabled=false; btn.innerText='Send code'; return; }
   const code=d.devCode;
   if(code){ document.getElementById('f_otpDisplay').classList.remove('hidden'); document.getElementById('f_otpBig').innerText=code; document.getElementById('f_code').value=code; }
   else { document.getElementById('f_otpDisplay').classList.add('hidden'); document.getElementById('f_code').value=''; }
   document.getElementById('f_msg').innerText=d.emailSent?`Reset code sent to ${email}. Check inbox and spam.`:`Code generated`;
   document.getElementById('f_msg').className='text-[13px] font-medium text-green-700';
   fSeconds=300; if(fTimer) clearInterval(fTimer);
   document.getElementById('f_countdown').classList.remove('hidden');
   function tick(){ const m=Math.floor(fSeconds/60), s=fSeconds%60; document.getElementById('f_countdown').innerText=`Code expires in ${m}:${s.toString().padStart(2,'0')}`; btn.innerText=`Resend in ${m}:${s.toString().padStart(2,'0')}`; fSeconds--; if(fSeconds<0){ clearInterval(fTimer); btn.disabled=false; btn.innerText='Send new code'; document.getElementById('f_countdown').innerText='Code expired - send new one'; } }
   tick(); fTimer=setInterval(tick,1000);
 }catch{ document.getElementById('f_msg').innerText='Network error'; btn.disabled=false; btn.innerText='Send code'; }
}
async function doResetPassword(){
 const email=document.getElementById('f_email').value.trim(), code=document.getElementById('f_code').value.trim(), newPassword=document.getElementById('f_newpass').value;
 if(!code||!newPassword) return alert('Enter code and new password');
 let r=await fetch('/api/auth/reset-password',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,code,newPassword})});
 let d=await r.json(); if(d.error) return document.getElementById('f_msg').innerText='❌ '+d.error;
 document.getElementById('f_msg').innerText='✅ '+d.message; document.getElementById('f_msg').className='text-[13px] font-medium text-green-700';
 setTimeout(()=>{ closeForgotModal(); showTab('login'); document.getElementById('l_email').value=email; },2000);
}

async function loadProducts(mine=false){
 const search=document.getElementById('search')?.value||''; let url=`/api/products?search=${encodeURIComponent(search)}&type=${currentFilter}`;
 let r=await fetch(url); let products=await r.json(); let buyerHtml='', myHtml='';
 products.forEach(p=>{
   const verified = p.sellerVerified ? `<span class="ml-1 px-2 py-0.5 bg-blue-600 text-white rounded-full text-[10px] font-bold">✓ Verified</span>` : '';
   const imgTag = `<img src="${p.image}" onerror="this.src='https://picsum.photos/seed/${p.id}/400/300'" class="w-full h-[180px] object-cover rounded-[12px]">`;
   if(mine && p.sellerId!==currentUser.id) return;
   const card = `<div class="bg-white border border-zinc-200 rounded-[18px] overflow-hidden hover:shadow-md transition"><div class="p-2.5">${imgTag}</div><div class="p-4"><div class="flex justify-between items-start gap-2"><h4 class="font-semibold text-[14px] leading-tight">${p.name}</h4><span class="text-[10px] px-2 py-1 bg-zinc-100 rounded-full uppercase font-semibold tracking-wide">${p.type}</span></div><p class="text-[13px] text-zinc-500 mt-1.5 line-clamp-2 leading-[1.4]">${p.description||''}</p><div class="mt-3.5 flex items-center justify-between"><div><div class="font-bold text-[15px]">$${p.price}</div><div class="text-[11px] text-zinc-500 mt-0.5">${p.sellerName}${verified} • ${p.category}</div></div>${!mine ? `<button onclick="openOrderModal('${p.id}','${p.name.replace(/'/g,"\\'")}','${p.type}')" class="px-4 py-2 bg-zinc-900 text-white rounded-full text-[12px] font-semibold">Buy now</button>` : `<button onclick="deleteProduct('${p.id}')" class="px-3 py-1.5 bg-red-50 text-red-600 rounded-full text-[11px] font-medium">Delete</button>`}</div>${!mine ? `<button onclick="reportSeller('${p.sellerId}','${p.id}')" class="mt-2.5 text-[11px] text-zinc-400 hover:text-zinc-600 underline">Report seller</button>` : ''}</div></div>`;
   if(mine) myHtml+=card; else buyerHtml+=card;
 });
 if(mine) document.getElementById('myProducts').innerHTML=myHtml||'<p class="text-[13px] text-zinc-500">You have not listed any products yet.</p>';
 if(document.getElementById('products')) document.getElementById('products').innerHTML=buyerHtml;
}
function filterType(t){ currentFilter=t; document.querySelectorAll('.typeBtn').forEach(b=>{b.classList.remove('bg-zinc-900','text-white'); b.classList.add('bg-white','border');}); event.target.classList.add('bg-zinc-900','text-white'); event.target.classList.remove('bg-white','border'); loadProducts(); }
async function addProduct(){
 const body={name:document.getElementById('p_name').value,price:document.getElementById('p_price').value,stock:document.getElementById('p_stock').value,category:document.getElementById('p_cat').value,image:document.getElementById('p_image').value,description:document.getElementById('p_desc').value,type:document.getElementById('p_type').value};
 if(!body.image){ const prev=document.getElementById('imgPrev'); if(prev && !prev.classList.contains('hidden') && prev.src) body.image=prev.src; }
 let r=await fetch('/api/products',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+token},body:JSON.stringify(body)});
 let d=await r.json(); if(d.error) return alert(d.error);
 // CLEAR FORM COMPLETELY - FIX for second image issue
 document.getElementById('p_name').value='';
 document.getElementById('p_price').value='';
 document.getElementById('p_stock').value='';
 document.getElementById('p_cat').value='';
 document.getElementById('p_image').value='';
 document.getElementById('p_desc').value='';
 document.getElementById('p_file').value='';
 const imgPrev=document.getElementById('imgPrev'); if(imgPrev){ imgPrev.classList.add('hidden'); imgPrev.src=''; }
 const upStatus=document.getElementById('uploadStatus'); if(upStatus) upStatus.innerText='';
 notify('Product published successfully');
 loadProducts(true);
 // On mobile, scroll to My Products so you can see it immediately
 setTimeout(()=>{
   const prodSec=document.getElementById('myProductsSection');
   if(prodSec){
     if(window.innerWidth < 768){
       prodSec.scrollIntoView({behavior:'smooth', block:'start'});
     } else {
       window.scrollTo({top:0,behavior:'smooth'});
     }
   }
 },300);
}
async function deleteProduct(id){ if(!confirm('Delete this product?')) return; await fetch('/api/products/'+id,{method:'DELETE',headers:{'Authorization':'Bearer '+token}}); loadProducts(true); }
function openOrderModal(productId,name,type){ pendingProduct={id:productId,name,type}; document.getElementById('orderProdName').innerText=name+' • '+type; document.getElementById('addressWrap').classList.toggle('hidden', type!=='hardware'); document.getElementById('orderModal').classList.remove('hidden'); }
function closeOrderModal(){ document.getElementById('orderModal').classList.add('hidden'); pendingProduct=null; }
async function confirmOrder(){
 if(!pendingProduct) return;
 const phone=document.getElementById('o_phone').value, address=document.getElementById('o_address').value, msg=document.getElementById('o_msg').value;
 if(!phone) return alert('Phone number is required');
 if(pendingProduct.type==='hardware' && !address) return alert('Delivery address is required for hardware');
 let r=await fetch('/api/orders',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+token},body:JSON.stringify({productId:pendingProduct.id,phone,deliveryAddress:address,message:msg})});
 let d=await r.json(); if(d.error) return alert(d.error);
 closeOrderModal(); notify(`Order ${d.code} placed. Confirmation email sent.`); loadBuyerOrders();
}
async function loadBuyerOrders(){
 let r=await fetch('/api/orders/buyer',{headers:{'Authorization':'Bearer '+token}}); let orders=await r.json();
 document.getElementById('buyerOrders').innerHTML=orders.map(o=>`<div class="bg-white border border-zinc-200 rounded-[16px] p-3 md:p-4 flex gap-3"><img src="${o.productImage}" class="w-14 h-14 md:w-16 md:h-16 rounded-[12px] object-cover flex-shrink-0"><div class="flex-1 min-w-0"><div class="flex flex-wrap justify-between items-start gap-1.5"><span class="font-semibold text-[13px] md:text-[14px] truncate">${o.productName}</span><span class="text-[10px] md:text-[11px] px-2 md:px-2.5 py-1 bg-zinc-900 text-white rounded-full font-medium flex-shrink-0">${o.code}</span></div><div class="text-[11px] md:text-[12px] text-zinc-500 mt-1">${o.sellerName} • ${o.status} • $${o.price}</div>${o.deliveryAddress?`<div class="text-[11px] md:text-[12px] mt-1 truncate">📍 ${o.deliveryAddress}</div>`:''}</div><select onchange="updateOrderStatus('${o.id}',this.value)" class="h-fit text-[11px] md:text-[12px] border border-zinc-200 rounded-full px-2 py-1 md:px-2.5 md:py-1.5 bg-white flex-shrink-0"><option>${o.status}</option><option value="confirmed">Confirm delivery</option></select></div>`).join('')||'<p class="text-[13px] text-zinc-500">No orders yet.</p>';
}
async function loadSellerOrders(){
 let r=await fetch('/api/orders/seller',{headers:{'Authorization':'Bearer '+token}}); let orders=await r.json();
 document.getElementById('sellerOrders').innerHTML=orders.map(o=>`<div class="bg-white border border-zinc-200 rounded-[16px] p-4"><div class="flex justify-between items-start"><span class="font-semibold text-[14px]">${o.productName}</span><span class="px-2.5 py-1 bg-zinc-900 text-white rounded-full text-[11px] font-medium">${o.code}</span></div><div class="text-[13px] mt-2 leading-[1.5]">Buyer: <b>${o.buyerName}</b> (${o.buyerEmail})<br>📞 ${o.buyerPhone}${o.deliveryAddress?`<br>📍 ${o.deliveryAddress}`:''}<br>Message: ${o.message||'-'}</div><div class="mt-3 flex flex-wrap gap-2"><span class="text-[11px] px-2.5 py-1 bg-zinc-100 rounded-full">${o.status}</span>${o.status==='pending'?`<button onclick="updateOrderStatus('${o.id}','accepted')" class="px-3 py-1 bg-zinc-900 text-white rounded-full text-[11px] font-medium">Accept</button><button onclick="updateOrderStatus('${o.id}','rejected')" class="px-3 py-1 bg-zinc-100 rounded-full text-[11px]">Reject</button>`:''}${o.status==='accepted'?`<button onclick="updateOrderStatus('${o.id}','shipped')" class="px-3 py-1 bg-blue-600 text-white rounded-full text-[11px]">Mark shipped</button><button onclick="updateOrderStatus('${o.id}','delivered')" class="px-3 py-1 bg-green-600 text-white rounded-full text-[11px]">Delivered</button>`:''}</div></div>`).join('')||'<p class="text-[13px] text-zinc-500">No incoming orders.</p>';
}
async function updateOrderStatus(id,status){ await fetch('/api/orders/'+id+'/status',{method:'PUT',headers:{'Content-Type':'application/json','Authorization':'Bearer '+token},body:JSON.stringify({status})}); loadBuyerOrders(); loadSellerOrders(); }
async function searchOrder(){ const code=document.getElementById('searchCode').value.trim(); if(!code) return; let r=await fetch('/api/orders/search?code='+encodeURIComponent(code),{headers:{'Authorization':'Bearer '+token}}); let orders=await r.json(); if(!orders.length) return alert('No order found with that code'); alert(`Found: ${orders[0].code} - ${orders[0].productName} - ${orders[0].status}`); }
async function reportSeller(sellerId,productId){ const reason=prompt('Please tell us why you are reporting this seller:'); if(!reason) return; let r=await fetch('/api/reports',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+token},body:JSON.stringify({sellerId,productId,reason})}); let d=await r.json(); if(d.error) return alert(d.error); notify(`Report submitted. Seller now has ${d.reportCount} reports.`); }
function connectSocket(){ if(socket) socket.disconnect(); socket=io({auth:{token}}); socket.on('new_order', o=>{ if(currentUser.role==='seller' && o.sellerId===currentUser.id){ notify('New order '+o.code); loadSellerOrders(); }}); socket.on('order_update', o=>{ notify('Order '+o.code+' is now '+o.status); loadBuyerOrders(); loadSellerOrders(); }); socket.on('new_product', ()=>{ if(currentUser.role==='buyer') loadProducts(); }); }
function notify(t){ let box=document.getElementById('notifBox'); let d=document.createElement('div'); d.className='bg-zinc-900 text-white px-4 py-3 rounded-[14px] text-[13px] shadow-xl'; d.innerText=t; box.appendChild(d); setTimeout(()=>d.remove(),4500); }
updateUI();
