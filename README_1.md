# MarketHub V10 - Render Ready

## Render Env Vars - ADD THESE IN RENDER DASHBOARD:

JWT_SECRET=your_long_random_32_chars
ADMIN_SECRET=your_admin_secret_only_you_know
ADMIN_EMAIL=owner@markethub.com
ADMIN_PASSWORD=YourStrongPass123
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=yourgmail@gmail.com
SMTP_PASS=16letterapppasswordwithoutspaces
MAIL_FROM_NAME=MarketHub

## Deploy:
Build: npm install
Start: npm start

If you see DEV MODE in logs, SMTP_USER or SMTP_PASS missing/wrong in Render Environment.