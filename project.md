# Competitor Website Monitoring & Change Alert

## 1. Project Overview

Ek web application jisme competitor ki website ka URL add karke usko monitor kiya jayega.

System website ka data crawl karke MongoDB mein save karega aur next check par **old vs new data compare** karega.

Change detect hone par notification milega.

---

## 2. Core Features

### 🔐 Single Admin Login

Koi registration/user management nahi.

Credentials `.env` mein:

```env
ADMIN_USERNAME=admin
ADMIN_PASSWORD=your_password
```

Sirf ek admin dashboard access karega.

---

### 🌐 Competitor Management

* Competitor add
* Competitor delete
* Competitor list
* Competitor detail
* Check Now button

Example:

```text
Name: ABC Travel
URL: https://abctravel.com
```

---

### 🔎 Website Discovery

System check karega:

```text
/robots.txt
/sitemap.xml
```

Sitemap se URLs discover honge aur robots.txt ke crawling rules respect honge.

Agar sitemap available nahi hai, accessible internal links se URLs discover kiye jayenge.

---

### 🕷️ Website Crawler

**Playwright + Cheerio**

Extract:

* URL
* Title
* Meta Description
* H1/H2
* Content
* Images
* Internal Links
* External Links
* Word Count
* Status Code
* Content Hash

---

## 3. Change Detection

Old aur new website data compare hoga.

Detect:

```text
+ New Page
- Deleted Page
+ New Blog
+ New Product/Package
💰 Price Change
📝 Content Change
🏷️ Title Change
📄 Meta Description Change
🔤 H1/H2 Change
🔗 New Internal Link
❌ Deleted Internal Link
🖼️ Image Change
```

---

## 4. Snapshot System

Har check ka snapshot save hoga.

```text
Old Snapshot
     ↓
New Crawl
     ↓
Compare
     ↓
Changes
     ↓
MongoDB
```

Change history bhi save hogi.

---

## 5. Notifications

Initial version:

* In-app notification
* Email notification

Example:

```text
🚨 Competitor Update

ABC Travel

+3 New Pages
+2 New Blogs
+1 Price Change
+12 Internal Links
```

---

## 6. Dashboard

Dashboard par:

```text
Competitors
Pages Monitored
Changes Today
New Pages
New Blogs
Price Changes
```

Competitor detail page par complete change history.

---

# 7. Tech Stack

### Frontend

* Next.js
* TypeScript
* Tailwind CSS

### Backend

* Next.js API / Node.js

### Crawler

* Playwright
* Cheerio

### Database

* MongoDB
* Mongoose

### Website Discovery

* Sitemap.xml
* robots.txt

### Notification

* Email

### Authentication

* Single admin credentials from `.env`

---

# 8. No AI / No Complex Infrastructure

Initial MVP mein:

```text
❌ AI / LLM
❌ Redis
❌ BullMQ
❌ Multiple users
❌ Paid crawling API
```

use nahi honge.

---

# 9. Basic Architecture

```text
Admin Login
    ↓
Dashboard
    ↓
Add Competitor
    ↓
robots.txt + sitemap.xml
    ↓
Playwright + Cheerio
    ↓
MongoDB
    ↓
Old vs New Comparison
    ↓
Change Detection
    ↓
Notification
```

---

# 10. Development Phases

### Phase 1

Admin login + dashboard

### Phase 2

Competitor management

### Phase 3

Sitemap + robots.txt discovery

### Phase 4

Playwright crawler

### Phase 5

MongoDB snapshots

### Phase 6

Change detection

### Phase 7

Notifications

### Phase 8

Change history + dashboard improvements

---

## Final Goal

**Competitor URL add karo → website crawl karo → data save karo → next check par changes detect karo → notification pao.**
