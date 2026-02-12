#!/usr/bin/env node
const puppeteer = require("puppeteer");

const URL =
	"https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/opportunities/calls-for-proposals";
const path = require("path");
const fs = require("fs");

async function findSearchInput(page) {
	const inputs = await page.$$("input");
	for (const input of inputs) {
		const attrs = await page.evaluate(
			(el) => ({
				type: el.type || "",
				name: el.name || "",
				id: el.id || "",
				placeholder: el.placeholder || "",
				className: el.className || "",
			}),
			input,
		);
		const combined = (
			attrs.type +
			" " +
			attrs.name +
			" " +
			attrs.id +
			" " +
			attrs.placeholder +
			" " +
			attrs.className
		).toLowerCase();
		if (
			attrs.type === "search" ||
			/search|keyword|keywords|q|query/.test(combined)
		) {
			return input;
		}
	}
	for (const input of inputs) {
		const info = await page.evaluate(
			(el) => ({
				type: el.type || "",
				visible: !!(el.offsetWidth || el.offsetHeight),
			}),
			input,
		);
		if ((info.type === "text" || info.type === "") && info.visible)
			return input;
	}
	return null;
}

(async () => {
	console.log("🚀 Script started...");
	const keyword =
		process.argv.slice(2).join(" ") ||
		(await (async () => {
			process.stdout.write("Enter search keyword: ");
			return await new Promise((resolve) => {
				process.stdin.resume();
				process.stdin.once("data", (data) => {
					process.stdin.pause();
					resolve(data.toString().trim());
				});
			});
		})());

	if (!keyword) {
		console.error("No keyword provided. Exiting.");
		process.exit(1);
	}
	console.log(`📝 Keyword: "${keyword}"`);

	console.log("🌐 Launching browser...");
	const browser = await puppeteer.launch({
		headless: false,
		defaultViewport: null,
		args: ["--start-maximized"],
	});
	console.log("✅ Browser launched");
	const page = await browser.newPage();
	console.log(`📍 Navigating to: ${URL}`);
	await page.goto(URL, { waitUntil: "networkidle2" });
	console.log("✅ Page loaded");

	console.log("🔍 Finding search input...");
	const inputHandle = await findSearchInput(page);
	if (inputHandle) {
		console.log("✅ Search input found");
		await inputHandle.focus();
		await inputHandle.click({ clickCount: 3 });
		console.log(`⌨️ Typing keyword: "${keyword}"`);
		await page.keyboard.type(keyword, { delay: 100 });
		await page.keyboard.press("Enter");
		console.log(`✅ Typed keyword "${keyword}" and pressed Enter.`);
		new Promise((r) => setTimeout(r, 2000));
	} else {
		console.warn(
			"⚠️ Could not locate search input on the page. Proceeding to extract from current view.",
		);
	}

	// Click "Accept all cookies" button
	console.log("🍪 Looking for cookie consent button...");
	const [cookieButton] = await page.$x(`//button[contains(text(), "Accept all cookies")]`);
	if (cookieButton) {
		console.log("✅ Cookie button found, clicking...");
		await cookieButton.click();
		console.log("✅ Cookie button clicked");
	} else {
		console.log("⚠️ Cookie button not found");
	}

	// Wait for results to load a bit
	console.log("⏳ Waiting for results to load...");
	await new Promise(r => setTimeout(r, 2000));
	console.log("✅ Results loaded");
  
	// wait for the link to appear
	console.log("🔗 Waiting for 'See all calls for proposals' link...");
	await page.waitForXPath(
    `//a[contains(text(), "See all calls for proposals")]`,
	);
	console.log("✅ Link appeared");
  
	// get it (returns an array)
	const [link] = await page.$x(
    `//a[contains(text(), "See all calls for proposals")]`,
	);
  
	if (link) {
		console.log("✅ Link found, clicking...");
    await link.click();
		console.log("✅ Link clicked");
	} else {
    throw new Error("Link not found");
	}
	//2
	console.log("🔎 Waiting for 'All filters' button...");
	await page.waitForXPath(
    `//button[.//span[contains(text(), "All filters")]]`,
	);
	console.log("✅ 'All filters' button found");

	const [linkFilter] = await page.$x(
    `//button[.//span[contains(text(), "All filters")]]`,
	);

	if (linkFilter) {
		console.log("✅ Scrolling 'All filters' button into view...");
		await linkFilter.evaluate(el => el.scrollIntoView({ behavior: "smooth", block: "center" }));
		await new Promise(r => setTimeout(r, 500));
		console.log("✅ Clicking 'All filters'...");
    await linkFilter.click();
		console.log("✅ 'All filters' clicked");
	} else {
    throw new Error("linkFilter not found");
	}

	console.log("⏳ Waiting for UI to settle...");
	await new Promise(r => setTimeout(r, 2000));
	console.log("✅ UI settled");

	console.log("🔍 Looking for sidebar...");
	await page.waitForSelector("div.eui-u-p-l");
	console.log("✅ Sidebar found");

	// grab a single ElementHandle
	const sidebar = await page.$("div.eui-u-p-l");

	console.log("📋 Scrolling sidebar into view...");
	await sidebar.evaluate(el => el.scrollIntoView({ behavior: "smooth", block: "center" }));
	console.log("✅ Sidebar scrolled");



 	///3
	console.log("🔘 Waiting for 'Closed' radio button...");
	await page.waitForXPath(
    `//label[contains(text(), "Closed")]`,
	);
	console.log("✅ 'Closed' button found");

	const [radioButtonForClsd] = await page.$x(
    `//label[contains(text(), "Closed")]`,
	);

	if (radioButtonForClsd) {
		console.log("✅ Clicking 'Closed' button...");
    await radioButtonForClsd.click();
		console.log("✅ 'Closed' button clicked");
	} else {
    throw new Error("radioButtonForClsd not found");
	}


	///4
	console.log("🔎 Waiting for 'View results' button...");
	await page.waitForXPath(
    `//button[.//span[contains(text(), "View results")]]`,
	);
	console.log("✅ 'View results' button found");

	const [viewResults] = await page.$x(
    `//button[.//span[contains(text(), "View results")]]`,
	);

	if (viewResults) {
		console.log("✅ Clicking 'View results'...");
    await viewResults.click();
		console.log("✅ 'View results' clicked");
	} else {
    throw new Error("viewResults not found");
	}
	console.log("🎉 Script completed successfully!");
  
	await new Promise(r => setTimeout(r, 2000));

	const results = await page.$$eval(
		"div.eui-card-header__container",
		(containers) => containers.map((container) => {
			const linkEl = container.querySelector("a.eui-u-text-link");
			const topicCodeEl = container.querySelector("sedia-result-card-type span.ng-star-inserted");
			const strongTags = container.querySelectorAll("strong.ng-star-inserted");
			
			return {
				title: linkEl ? linkEl.textContent.trim() : "N/A",
				href: linkEl ? linkEl.href : "N/A",
				topicCode: topicCodeEl ? topicCodeEl.textContent.trim() : "N/A",
				openingDate: strongTags[0] ? strongTags[0].textContent.trim() : "N/A",
				deadlineDate: strongTags[1] ? strongTags[1].textContent.trim() : "N/A",
			};
		}),
	);

	console.log("Found results:", results.length);
	results.forEach((result, index) => {
		console.log(`\n📋 Result ${index + 1}:`);
		console.log(`   Title: ${result.title}`);
		console.log(`   Code: ${result.topicCode}`);
		console.log(`   Opening: ${result.openingDate}`);
		console.log(`   Deadline: ${result.deadlineDate}`);
		console.log(`   URL: ${result.href}`);
	});

// 	// keep process alive so browsers remain open
	process.stdin.resume();
})().catch((err) => {
	console.error(err);
	process.exit(1);
});
