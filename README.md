# 🇪🇺 EU Proposal Bot & AI Writer

A comprehensive system to **automatically discover** EU funding opportunities and **generate professional AI proposals** in seconds.

This guide is designed for **non-technical users** to set up the system from scratch.

---

## 🚀 Overview

The system consists of two parts:
1.  **The Scraper (Bot)**: Runs on your computer. It visits the EU portal, finds calls, and uploads them to your database.
2.  **The Web App**: Hosted on the internet (Vercel). It allows you to view discoveries, edit them, and click "Generate" to have AI write your grant application.

---

## 🛠️ Phase 1: Create Your "Brain" (Firebase Setup)

Firebase is where all your data lives. It's free for this usage level.

### 1. Create a Firebase Project
1.  Go to [Firebase Console](https://console.firebase.google.com/).
2.  Click **"Add project"** and name it (e.g., `EU-Proposal-Bot`).
3.  Disable Google Analytics (not needed) and click **"Create project"**.

### 2. Enable the Database
1.  In the left sidebar, click **"Build"** -> **"Realtime Database"**.
2.  Click **"Create Database"**.
3.  Choose a location (closest to you) and click **Next**.
4.  Select **"Start in test mode"** (this is easier for setup) and click **Enable**.
5.  **Copy the URL** (it looks like `https://your-project.firebaseio.com/`). This is your `FIREBASE_DATABASE_URL`.

### 3. Get the "Service Account" Key (For the Bot)
*This file allows the Bot to write to your database.*
1.  Click the ⚙️ (gear icon) next to **Project Overview** -> **Project settings**.
2.  Go to the **"Service accounts"** tab.
3.  Click **"Generate new private key"**.
4.  A file named `something-firebase-adminsdk-...json` will download.
5.  **Rename this file to `serviceAccount.json`** and place it inside the main bot folder.

### 4. Get the "Web Config" (For the Web App)
*This allows the Website to read your database.*
1.  In **Project settings**, go to the **"General"** tab.
2.  Scroll down to "Your apps" and click the `</>` (web) icon.
3.  Name it `Web App` and click **Register app**.
4.  You will see a code block containing `apiKey`, `authDomain`, etc. Keep this tab open; you'll need these values for Vercel.

---

## 🤖 Phase 2: AI Power (Perplexity Setup)

To generate the proposals, we use Perplexity AI.

1.  Go to [Perplexity Settings](https://www.perplexity.ai/settings/api).
2.  Add credit (e.g., $5 - it lasts a long time).
3.  Generate an **API Key**. It starts with `pplx-...`.
4.  Copy this key. This is your `PERPLEXITY_API_KEY`.

---

## 💻 Phase 3: Setup the Bot (Local Computer)

### 1. Install Node.js
Go to [nodejs.org](https://nodejs.org/) and download the **LTS** version. Install it like any other program.

### 2. Prepare the Folder
1.  Open the folder containing this code.
2.  Make sure your `serviceAccount.json` is in this folder.
3.  Create a file named `.env` in this main folder and paste this:
    ```text
    FIREBASE_SERVICE_ACCOUNT_PATH=./serviceAccount.json
    FIREBASE_DATABASE_URL=https://your-project-url.firebaseio.com/
    ```
    *(Replace with your actual URL from Phase 1)*

### 3. Run the Bot
1.  Open your computer's terminal (Command Prompt on Windows, Terminal on Mac).
2.  Type `cd` followed by a space, then drag the bot folder into the window and press Enter.
3.  Type `npm install` and wait for it to finish.
4.  To start searching, type:
    ```bash
    node puppeteer_scraper.js "your search topic"
    ```
    *Example: `node puppeteer_scraper.js "hydrogen energy"`*

---

## 🌐 Phase 4: Host the Website (Vercel)

You want to access your proposals from anywhere without keeping your computer on.

### 1. Upload to GitHub
1.  Create a free account on [GitHub](https://github.com/).
2.  Create a "New Repository" and upload all the files there (except `node_modules`).

### 1. Dedicated Hosting (Optional)
If you do not want to set up your own website, you can use the pre-configured hosted version:
**[https://upwork-bot-eu.vercel.app](https://upwork-bot-eu.vercel.app)**
*(Note: You still need to run the Bot locally to feed data into your own database used by this site).*

### 2. Host Your Own (Recommended for full control)
You may want to host your own copy to have total control over the data and AI settings.
3.  Select your GitHub repository.
4.  **CRITICAL**: Under **"Root Directory"**, click "Edit" and select the `web` folder.
5.  Open the **"Environment Variables"** section and add the following keys with the values from your Firebase Web Config (Phase 1, Step 4) and Perplexity (Phase 2):

| Key | Value |
| :--- | :--- |
| `NEXT_PUBLIC_FIREBASE_API_KEY` | Your apiKey |
| `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | Your authDomain |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | Your projectId |
| `NEXT_PUBLIC_FIREBASE_DATABASE_URL` | Your databaseURL |
| `NEXT_PUBLIC_FIREBASE_APP_ID` | Your appId |
| `PERPLEXITY_API_KEY` | Your pplx-... key |

6.  Click **"Deploy"**.

### 3. Done!
Vercel will give you a link (e.g., `https://my-proposal-bot.vercel.app`). Open it to see your proposals!

---

## 📝 Maintenance
*   **Update Proposals**: Run the bot on your computer whenever you want to find new calls.
*   **Generate Proposals**: Open your Vercel website, select a call, and click "Apply/Draft". The AI will write the content and you can download it as PDF or Word.

---

> [!TIP]
> **Security**: Never share your `serviceAccount.json` or `.env` files with anyone. They are the keys to your database.
