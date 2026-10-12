import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import { Admin, HeroSlide, Teacher, Notice, Inquiry, SiteSettings } from '../models/index.js';
import { requireAdmin } from '../middleware/auth.js';
import { sendInquiryNotification } from '../services/email.js';
const router=Router();
const loginLimit=rateLimit({windowMs:15*60*1000,max:10,standardHeaders:true,legacyHeaders:false,message:{message:'Too many login attempts. Try again later.'}});
const clean=(v,max=5000)=>String(v??'').trim().slice(0,max);
router.post('/auth/setup',async(req,res,next)=>{try{
  if(!process.env.ADMIN_SETUP_KEY||req.headers['x-setup-key']!==process.env.ADMIN_SETUP_KEY) return res.status(403).json({message:'Invalid setup key'});
  if(await Admin.countDocuments()) return res.status(409).json({message:'An administrator already exists'});
  const {name,email,password}=req.body||{};
  if(!name||!email||!/^\S+@\S+\.\S+$/.test(email)||!password||password.length<12) return res.status(400).json({message:'Provide name, valid email, and a password of at least 12 characters'});
  const admin=await Admin.create({name:clean(name,120),email:clean(email,254).toLowerCase(),passwordHash:await bcrypt.hash(password,12)});
  res.status(201).json({message:'Admin created. You can now log in.',email:admin.email});
}catch(e){next(e)}});
router.post('/auth/login',loginLimit,async(req,res,next)=>{try{
 const email=clean(req.body?.email,254).toLowerCase(),password=String(req.body?.password||'');
 const admin=await Admin.findOne({email}); if(!admin||!await bcrypt.compare(password,admin.passwordHash)) return res.status(401).json({message:'Invalid email or password'});
 const token=jwt.sign({id:admin._id,email:admin.email,name:admin.name},process.env.JWT_SECRET,{expiresIn:'8h'});
 res.json({token,admin:{name:admin.name,email:admin.email}});
}catch(e){next(e)}});
router.get('/public/settings',async(req,res,next)=>{try{let s=await SiteSettings.findOne({key:'main'});if(!s)s=await SiteSettings.create({key:'main'});res.json(s)}catch(e){next(e)}});
router.get('/public/hero',async(req,res,next)=>{try{res.json(await HeroSlide.find({active:true}).sort({order:1,createdAt:-1}))}catch(e){next(e)}});
router.get('/public/teachers',async(req,res,next)=>{try{res.json(await Teacher.find({active:true}).sort({createdAt:-1}))}catch(e){next(e)}});
router.get('/public/notices',async(req,res,next)=>{try{res.json(await Notice.find({active:true,publishAt:{$lte:new Date()},$or:[{expiresAt:null},{expiresAt:{$gt:new Date()}}]}).sort({publishAt:-1}).limit(30))}catch(e){next(e)}});
router.post('/public/inquiries',async(req,res,next)=>{try{
 const b=req.body||{}; const parentName=clean(b.parentName,120),email=clean(b.email,254).toLowerCase(),message=clean(b.message,4000);
 if(!parentName||!/^\S+@\S+\.\S+$/.test(email)||message.length<5) return res.status(400).json({message:'Please provide your name, a valid email, and a message.'});
 if(clean(b.website,200)) return res.status(201).json({message:'Thank you. Your message has been received.'});
 const inquiry=await Inquiry.create({type:b.type==='admission'?'admission':'contact',parentName,email,message,studentName:clean(b.studentName,120),phone:clean(b.phone,40),requestedClass:clean(b.requestedClass,80),subject:clean(b.subject,180)});
 let emailSent=false,emailWarning=''; try{await sendInquiryNotification(inquiry);emailSent=true;await Inquiry.updateOne({_id:inquiry._id},{emailNotificationSent:true})}catch(err){emailWarning='Your inquiry was saved, but the school email notification could not be sent. The administrator can review it in the dashboard.';console.error('Inquiry email failed:',err.message)}
 res.status(201).json({message:'Thank you! Your inquiry has been received.',emailSent,emailWarning});
}catch(e){next(e)}});
router.use('/admin',requireAdmin);
router.get('/admin/dashboard',async(req,res,next)=>{try{const [inquiries,unread,teachers,notices,slides]=await Promise.all([Inquiry.countDocuments(),Inquiry.countDocuments({read:false}),Teacher.countDocuments(),Notice.countDocuments({active:true}),HeroSlide.countDocuments({active:true})]);res.json({inquiries,unread,teachers,notices,slides})}catch(e){next(e)}});
router.get('/admin/inquiries',async(req,res,next)=>{try{res.json(await Inquiry.find().sort({createdAt:-1}).limit(300))}catch(e){next(e)}});
router.patch('/admin/inquiries/:id',async(req,res,next)=>{try{const update={};if(['New','In Progress','Replied','Closed'].includes(req.body.status))update.status=req.body.status;if(typeof req.body.read==='boolean')update.read=req.body.read;const item=await Inquiry.findByIdAndUpdate(req.params.id,update,{new:true,runValidators:true});if(!item)return res.status(404).json({message:'Inquiry not found'});res.json(item)}catch(e){next(e)}});
router.get('/admin/settings',async(req,res,next)=>{try{let s=await SiteSettings.findOne({key:'main'});if(!s)s=await SiteSettings.create({key:'main'});res.json(s)}catch(e){next(e)}});
router.put('/admin/settings',async(req,res,next)=>{try{const allowed=['schoolName','tagline','phone','email','address','principalMessage','logoUrl'];const update={};for(const k of allowed)if(req.body[k]!==undefined)update[k]=clean(req.body[k],k==='principalMessage'?3000:500);const s=await SiteSettings.findOneAndUpdate({key:'main'},{$set:update,$setOnInsert:{key:'main'}},{new:true,upsert:true,runValidators:true});res.json(s)}catch(e){next(e)}});
function crud(path,Model,fields){
 router.get(`/admin/${path}`,async(req,res,next)=>{try{res.json(await Model.find().sort({createdAt:-1}))}catch(e){next(e)}});
 router.post(`/admin/${path}`,async(req,res,next)=>{try{const data={};for(const f of fields)if(req.body[f]!==undefined)data[f]=req.body[f];res.status(201).json(await Model.create(data))}catch(e){next(e)}});
 router.put(`/admin/${path}/:id`,async(req,res,next)=>{try{const data={};for(const f of fields)if(req.body[f]!==undefined)data[f]=req.body[f];const item=await Model.findByIdAndUpdate(req.params.id,data,{new:true,runValidators:true});if(!item)return res.status(404).json({message:'Item not found'});res.json(item)}catch(e){next(e)}});
 router.delete(`/admin/${path}/:id`,async(req,res,next)=>{try{const item=await Model.findByIdAndDelete(req.params.id);if(!item)return res.status(404).json({message:'Item not found'});res.json({message:'Deleted successfully'})}catch(e){next(e)}});
}
crud('hero',HeroSlide,['title','subtitle','imageUrl','buttonText','buttonUrl','active','order']);
crud('teachers',Teacher,['name','role','subject','bio','imageUrl','active']);
crud('notices',Notice,['title','body','category','publishAt','expiresAt','active']);
router.get('/admin/email-test',async(req,res)=>{try{await sendInquiryNotification({type:'SMTP test',parentName:'Admin test',email:process.env.ADMIN_EMAIL,phone:'',studentName:'',requestedClass:'',subject:'SMTP test',message:'SMTP connection test from Little Stars admin panel.'});res.json({message:'Test email sent successfully'})}catch(e){res.status(400).json({message:e.message})}});
export default router;
