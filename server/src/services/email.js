import nodemailer from 'nodemailer';
export async function sendInquiryNotification(inquiry){
  const required=['SMTP_HOST','SMTP_USER','SMTP_PASS','ADMIN_EMAIL'];
  const missing=required.filter(k=>!process.env[k]);
  if(missing.length) throw new Error(`SMTP is not configured: ${missing.join(', ')}`);
  const transporter=nodemailer.createTransport({host:process.env.SMTP_HOST,port:Number(process.env.SMTP_PORT||587),secure:String(process.env.SMTP_SECURE).toLowerCase()==='true',auth:{user:process.env.SMTP_USER,pass:process.env.SMTP_PASS}});
  await transporter.sendMail({from:process.env.EMAIL_FROM||process.env.SMTP_USER,to:process.env.ADMIN_EMAIL,replyTo:inquiry.email,subject:`School ${inquiry.type} inquiry: ${inquiry.parentName}`,text:`Name: ${inquiry.parentName}\nEmail: ${inquiry.email}\nPhone: ${inquiry.phone||'Not provided'}\nStudent: ${inquiry.studentName||'Not provided'}\nClass: ${inquiry.requestedClass||'Not provided'}\nSubject: ${inquiry.subject||'Not provided'}\n\n${inquiry.message}`});
}
