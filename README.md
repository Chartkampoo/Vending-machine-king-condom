# King Condom — Automated Vending Machine Kiosk

ระบบจำลองตู้จำหน่ายถุงยางอนามัยอัตโนมัติ (Automated Condom Vending Machine Kiosk) พร้อมระบบฐานข้อมูล MySQL และระบบจัดการสต็อก/หลังบ้าน

## 🚀 ฟีเจอร์หลัก (Features)
- **Interactive Vending Cabinet:** หน้าจอแสดงผลตู้จำหน่ายพร้อมชั้นวางสินค้า (A1–D4), สปริงหมุนจ่ายของ (Spiral Coil) และอนิเมชั่นของตกจำลองระบบฟิสิกส์
- **Multi-channel Payment:** รองรับการชำระเงินหลายรูปแบบ (เงินสดพร้อมคำนวณเงินทอน, สแกน QR PromptPay, แตะบัตร Contactless)
- **Bilingual Support:** สลับภาษาไทย / English ได้แบบ Real-time
- **Dark / Light Theme:** โหมดมืดและสว่าง
- **Database & Inventory Tracking:** เชื่อมต่อกับ MySQL บันทึกสต็อกสินค้า, ประวัติการสั่งซื้อ และการเคลื่อนไหวของสินค้า
- **Database Viewer & Admin:** หน้าจัดการสินค้า สต็อก และดู Transaction แบบเรียลไทม์

## 🛠️ เทคโนโลยีที่ใช้ (Tech Stack)
- **Frontend:** HTML5, Vanilla CSS, JavaScript (ES6+)
- **Backend:** Node.js (HTTP Server & REST APIs)
- **Database:** MySQL 8.x (`mysql2` connection pool)

## 📦 การติดตั้งและการใช้งาน (Getting Started)

### 1. นำเข้าฐานข้อมูล MySQL
```bash
mysql -u root -p < schema.sql
```

### 2. ติดตั้ง Dependencies
```bash
npm install
```

### 3. รันเซิร์ฟเวอร์
```bash
npm start
```
ระบบจะเปิดให้บริการที่:
- หน้าตู้จำหน่าย: `http://localhost:8080/`
- หน้าจัดการฐานข้อมูล: `http://localhost:8080/dbviewer.html`
