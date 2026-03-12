#!/usr/bin/env node

/**
 * EU Funding & Tenders Portal Integrated Scraper
 * Discovers proposals and extracts detailed data in one workflow
 */

const puppeteer = require("puppeteer");
const path = require("path");
const fs = require("fs");
const { uploadJsonFileToRTDB } = require("./firebaseClient");

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function cleanText(text) {
	if (!text) return null;
	return text
		.trim()
		.replace(/\s+/g, " ")
		.replace(/\n\s*\n/g, "\n");
}

function sanitizeFirebaseKey(key) {
	if (!key) return 'unknown';
	return key
		.replace(/[.#$/\[\]]/g, '_')
		.replace(/_+/g, '_')
		.replace(/^_|_$/g, '')
		.trim() || 'unknown';
}

function preserveListFormatting(html) {
	if (!html) return null;

	let text = html.replace(/<li[^>]*>/gi, "• ");
	text = text.replace(/<\/li>/gi, "\n");
	text = text.replace(/<br\s*\/?>/gi, "\n");
	text = text.replace(/<[^>]*>/g, " ");

	text = text
		.replace(/\s+/g, " ")
		.replace(/•\s+/g, "\n• ")
		.trim();

	return text || null;
}

async function extractTextWithFallback(page, selectors) {
	if (!Array.isArray(selectors)) {
		selectors = [selectors];
	}

	for (const selector of selectors) {
		try {
			let element;

			if (selector.includes("[") || selector.includes("(") || selector.includes("//")) {
				const elements = await page.$x(selector);
				element = elements[0] || null;
			} else {
				element = await page.$(selector);
			}

			if (element) {
				const text = await page.evaluate(
					(el) => el.textContent.trim(),
					element,
				);
				if (text && text.length > 0) return cleanText(text);
			}
		} catch (e) {
			continue;
		}
	}

	// Last resort: search for elements containing the keyword
	try {
		const lastSelector = selectors[selectors.length - 1];
		const keyword = lastSelector.match(/contains\("([^"]+)"\)/)?.[1] || '';
		
		if (keyword) {
			const found = await page.evaluate((kw) => {
				const elements = Array.from(document.querySelectorAll('*'));
				for (const el of elements) {
					if (el.textContent.includes(kw) && el.children.length <= 3) {
						const text = el.textContent.trim();
						if (text.length > kw.length) {
							return text;
						}
					}
				}
				return null;
			}, keyword);
			
			if (found) return cleanText(found);
		}
	} catch (e) {
		// Silent fail
	}

	return null;
}

async function extractHTMLContent(page, selector) {
	try {
		let element;

		if (selector.includes("[")) {
			const elements = await page.$x(selector);
			element = elements[0] || null;
		} else {
			element = await page.$(selector);
		}

		if (!element) return null;

		const html = await page.evaluate(
			(el) => el.innerHTML,
			element,
		);

		return preserveListFormatting(html);
	} catch (error) {
		return null;
	}
}

async function extractTableData(page, tableSelector = "table") {
	try {
		return await page.evaluate((selector) => {
			const table = document.querySelector(selector);
			if (!table) return [];

			const rows = table.querySelectorAll("tbody tr");
			const headers = Array.from(
				table.querySelectorAll("thead th"),
			).map((th) => th.textContent.trim());

			const data = [];
			rows.forEach((row) => {
				const cells = Array.from(row.querySelectorAll("td"));
				const rowData = {};

				cells.forEach((cell, index) => {
					const header = headers[index] || `column_${index}`;
					const value = cell.textContent.trim();
					if (value) rowData[header] = value;
				});

				if (Object.keys(rowData).length > 0) {
					data.push(rowData);
				}
			});

			return data;
		}, tableSelector);
	} catch (error) {
		return [];
	}
}

// ============================================================================
// SEARCH FUNCTIONS
// ============================================================================

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

async function discoverProposals(page, keyword) {
	console.log("\n" + "=".repeat(70));
	console.log("PHASE 1: DISCOVERY");
	console.log("=".repeat(70));

	const URL =
		"https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/opportunities/calls-for-proposals";

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
		console.log(
			`✅ Typed keyword "${keyword}" and pressed Enter.`,
		);
		await new Promise((r) => setTimeout(r, 2000));
	} else {
		console.warn(
			"⚠️ Could not locate search input on the page. Proceeding...",
		);
	}

	// Click "Accept all cookies" button
	console.log("🍪 Looking for cookie consent button...");
	const [cookieButton] = await page.$x(
		`//button[contains(text(), "Accept all cookies")]`,
	);
	if (cookieButton) {
		console.log("✅ Cookie button found, clicking...");
		await cookieButton.click();
		console.log("✅ Cookie button clicked");
	} else {
		console.log("⚠️ Cookie button not found");
	}

	console.log("⏳ Waiting for results to load...");
	await new Promise((r) => setTimeout(r, 2000));
	console.log("✅ Results loaded");

	console.log("🔗 Waiting for 'See all calls for proposals' link...");
	await page.waitForXPath(
		`//a[contains(text(), "See all calls for proposals")]`,
		{ timeout: 60000 }
	);
	console.log("✅ Link appeared");

	const [link] = await page.$x(
		`//a[contains(text(), "See all calls for proposals")]`,
	);

	if (link) {
		console.log("✅ Link found, clicking...");
		try {
			await link.click();
		} catch (e) {
			console.log("⚠️ Click failed, trying evaluate click...");
			await page.evaluate((el) => el.click(), link);
		}
		console.log("✅ Link clicked");
	} else {
		throw new Error("Link not found");
	}

	console.log("⏳ Waiting for portal to transition...");
	await new Promise((r) => setTimeout(r, 5000));

	console.log("🔎 Waiting for 'All filters' button...");
	try {
		await page.waitForXPath(
			`//button[.//span[contains(text(), "All filters")]]`,
			{ timeout: 5000 }
		);
		console.log("✅ 'All filters' button found");

		const [linkFilter] = await page.$x(
			`//button[.//span[contains(text(), "All filters")]]`,
		);

		if (linkFilter) {
			console.log("✅ Scrolling 'All filters' button into view...");
			await linkFilter.evaluate((el) =>
				el.scrollIntoView({
					behavior: "smooth",
					block: "center",
				}),
			);
			await new Promise((r) => setTimeout(r, 500));
			console.log("✅ Clicking 'All filters'...");
			await linkFilter.click();
			console.log("✅ 'All filters' clicked");
		}
	} catch (e) {
		console.log("⚠️ 'All filters' button not found, continuing anyway...");
	}

	console.log("⏳ Waiting for UI to settle...");
	await new Promise((r) => setTimeout(r, 2000));
	console.log("✅ UI settled");

	console.log("🔍 Looking for sidebar...");
	await page.waitForSelector("div.eui-u-p-l", { timeout: 60000 });
	console.log("✅ Sidebar found");

	const sidebar = await page.$("div.eui-u-p-l");

	console.log("📋 Scrolling sidebar into view...");
	await sidebar.evaluate((el) =>
		el.scrollIntoView({ behavior: "smooth", block: "center" }),
	);
	console.log("✅ Sidebar scrolled");

	console.log("🔘 Waiting for 'Closed' radio button...");
	await page.waitForXPath(`//label[contains(text(), "Closed")]`, { timeout: 30000 });
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

	console.log("🔎 Waiting for 'View results' button...");
	await page.waitForXPath(
		`//button[.//span[contains(text(), "View results")]]`,
		{ timeout: 30000 }
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

	await new Promise((r) => setTimeout(r, 2000));

	console.log("📊 Extracting total items count...");
	let totalItemsFound = 0;
	try {
		await page.waitForSelector('strong', { timeout: 5000 });
		totalItemsFound = await page.evaluate(() => {
			const containers = document.querySelectorAll('div[class*="col-sm"], div[class*="col-lg"], div[class*="col-xl"]');
			for (const container of containers) {
				if (container.textContent.includes('item(s) found')) {
					const strong = container.querySelector('strong');
					if (strong) {
						return parseInt(strong.textContent.trim(), 10) || 0;
					}
				}
			}
			return 0;
		});
		console.log(`✅ Total items found: ${totalItemsFound}`);
	} catch (e) {
		console.log("⚠️ Could not extract total items count");
	}

	console.log("📜 Scrolling to bottom of page...");
	await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
	await new Promise((r) => setTimeout(r, 1000));

	console.log("🔢 Changing pagination size to 100...");
	try {
		await page.waitForSelector('select.page-size__select', { timeout: 5000 });
		await page.select('select.page-size__select', '100');
		await page.evaluate(() => {
			const select = document.querySelector('select.page-size__select');
			if (select) {
				select.dispatchEvent(new Event('change', { bubbles: true }));
			}
		});
		console.log("✅ Page size set to 100");
		await new Promise((r) => setTimeout(r, 3000));
	} catch (e) {
		console.log("⚠️ Could not change pagination size, continuing with default");
	}

	const allResults = [];

	const extractCurrentPageResults = async () => {
		await page.waitForSelector("div.eui-card-header__container", { timeout: 30000 });
		return await page.$$eval(
			"div.eui-card-header__container",
			(containers) =>
				containers.map((container) => {
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
	};

	console.log("📄 Checking for pagination...");
	const paginationButtons = await page.$$('div.eui-paginator__page-navigation-numbers button');
	const totalPages = paginationButtons.length;
	console.log(`✅ Found ${totalPages > 0 ? totalPages : 1} page(s)`);

	if (totalPages > 1) {
		for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
			console.log(`\n📖 Processing page ${pageNum} of ${totalPages}...`);

			if (pageNum > 1) {
				const pageButtons = await page.$$('div.eui-paginator__page-navigation-numbers button');
				const targetButton = pageButtons[pageNum - 1];
				if (targetButton) {
					await targetButton.click();
					await new Promise((r) => setTimeout(r, 3000));
				}
			}

			const pageResults = await extractCurrentPageResults();
			allResults.push(...pageResults);
			console.log(`✅ Extracted ${pageResults.length} results from page ${pageNum}`);
		}
	} else {
		const pageResults = await extractCurrentPageResults();
		allResults.push(...pageResults);
	}

	// Deduplicate discovery results by URL
	const uniqueResultsMap = new Map();
	allResults.forEach(r => {
		if (r.href && r.href !== 'N/A' && !uniqueResultsMap.has(r.href)) {
			uniqueResultsMap.set(r.href, r);
		}
	});
	const results = Array.from(uniqueResultsMap.values());

	console.log(`\n✅ Found ${results.length} unique proposals (Total reported: ${totalItemsFound})`);
	results.forEach((result, index) => {
		console.log(`\n📋 Result ${index + 1}:`);
		console.log(`   Title: ${result.title}`);
		console.log(`   Code: ${result.topicCode}`);
		console.log(`   Opening: ${result.openingDate}`);
		console.log(`   Deadline: ${result.deadlineDate}`);
		console.log(`   URL: ${result.href}`);
	});

	try {
		if (process.env.FIREBASE_DATABASE_URL || process.env.FIREBASE_SERVICE_ACCOUNT_PATH || process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
			console.log('⬆️ Uploading discovery results to Firebase (Overwriting old runs)...');
			const { initFirebase } = require('./firebaseClient');
			const admin = initFirebase();
			const db = admin.database();
			
			// Clear old discovery runs to leave only the current one
			await db.ref('/eu_discovery_results').remove();
			
			const titles = results.map(r => r.title).filter(t => t && t !== 'N/A');
			const ref = db.ref('/eu_discovery_results').push();
			await ref.set({
				createdAt: new Date().toISOString(),
				titles,
				data: results,
			});
			console.log(`✅ Discovery results uploaded to Firebase (only current run remains)`);
		}
	} catch (e) {
		console.warn('⚠️ Firebase discovery upload failed:', e.message || e);
	}

	// Try minimal local file write - wrap in try/catch to avoid fatal error if disk is full
	try {
		const discoveryFile = path.join(__dirname, "proposal_discovery_results.json");
		fs.writeFileSync(discoveryFile, JSON.stringify(results, null, 2), "utf8");
		console.log(`💾 Discovery results saved locally.`);
	} catch (e) {
		console.warn(`⚠️ Local discovery file save failed (likely disk full): ${e.message}`);
	}

	// Extract just the URLs for processing
	const urls = results
		.map((r) => r.href)
		.filter((url) => url && url !== "N/A");

	return urls;
}

// ============================================================================
// EXTRACTION FUNCTIONS
// ============================================================================

async function extractGeneralInformation(page) {
	try {
		const data = {
			programme: await extractTextWithFallback(page, [
				'//dt[contains(text(), "Programme")]/following-sibling::dd[1]',
				'//div[contains(@class, "programme")]//span',
				'//label[contains(text(), "Programme")]/following-sibling::div[1]',
				'//h4[contains(text(), "Programme")]/following-sibling::p',
				'//div[contains(., "Programme")]//following-sibling::div[1]',
			]),

			call: await extractTextWithFallback(page, [
				'//dt[contains(text(), "Call")]/following-sibling::dd[1]',
				'//dt[contains(text(), "Call identifier")]/following-sibling::dd[1]',
				'//label[contains(text(), "Call")]/following-sibling::div[1]',
				'//h4[contains(text(), "Call")]/following-sibling::p',
				'//span[contains(@class, "call-title")]',
			]),

			typeOfAction: await extractTextWithFallback(page, [
				'//dt[contains(text(), "Type of action")]/following-sibling::dd[1]',
				'//label[contains(text(), "Type of action")]/following-sibling::div[1]',
				'//span[contains(., "Type of action")]/../following-sibling::*[1]',
				'//div[contains(@class, "action-type")]',
			]),

			typeMGA: await extractTextWithFallback(page, [
				'//dt[contains(text(), "Type of MGA")]/following-sibling::dd[1]',
				'//label[contains(text(), "MGA")]/following-sibling::div[1]',
				'//span[contains(., "Type of MGA")]/../following-sibling::*[1]',
			]),

			projectStatus: await extractTextWithFallback(page, [
				'//dt[contains(text(), "Status")]/following-sibling::dd[1]',
				'//dt[contains(text(), "Project status")]/following-sibling::dd[1]',
				'//label[contains(text(), "Status")]/following-sibling::div[1]',
				'//span[contains(., "Status")]/../following-sibling::*[1]',
			]),

			deadlineModel: await extractTextWithFallback(page, [
				'//dt[contains(text(), "Deadline model")]/following-sibling::dd[1]',
				'//label[contains(text(), "Deadline model")]/following-sibling::div[1]',
				'//span[contains(., "Deadline model")]/../following-sibling::*[1]',
			]),

			openingDate: await extractTextWithFallback(page, [
				'//dt[contains(text(), "Opening date")]/following-sibling::dd[1]',
				'//label[contains(text(), "Opening date")]/following-sibling::div[1]',
				'//span[contains(., "Opening date")]/../following-sibling::*[1]',
			]),

			deadlineDate: await extractTextWithFallback(page, [
				'//dt[contains(text(), "Deadline")]/following-sibling::dd[1]',
				'//label[contains(text(), "Deadline")]/following-sibling::div[1]',
				'//span[contains(., "Deadline")]/../following-sibling::*[1]',
			]),
		};

		Object.keys(data).forEach((key) => {
			if (!data[key]) delete data[key];
		});

		return data;
	} catch (error) {
		console.warn(
			`⚠️ Error extracting general information: ${error.message}`,
		);
		return {};
	}
}

async function extractTopicDescription(page) {
	try {
		const data = {
			expectedOutcome: null,
			objective: null,
			scope: null,
			budgetOverview: null,
			specificContent: null,
		};

		// Try to extract from eui-card structure with topicdescriptionkind spans
		const euiCardContent = await page.evaluate(() => {
			const result = {};
			
			// Find all topicdescriptionkind spans
			const spans = Array.from(document.querySelectorAll('span.topicdescriptionkind, .topicdescriptionkind'));
			
			spans.forEach(span => {
				const text = span.textContent.trim().toLowerCase().replace(':', '');
				let content = null;

				// Get the next element(s) after the span
				let nextEl = span.nextElementSibling;
				
				if (nextEl) {
					if (nextEl.tagName === 'UL') {
						// For lists, collect all li items
						const items = Array.from(nextEl.querySelectorAll('li')).map(li => li.textContent.trim());
						content = items.join('\n• ');
						if (content) content = '• ' + content;
					} else if (nextEl.tagName === 'P') {
						// For paragraphs, get text
						content = nextEl.textContent.trim();
					} else {
						// Try to get text from next element or siblings
						content = nextEl.textContent.trim();
					}
				}

				if (text.includes('expected outcome')) {
					result.expectedOutcome = content;
				} else if (text.includes('objective')) {
					result.objective = content;
				} else if (text.includes('scope')) {
					result.scope = content;
				}
			});

			return result;
		});

		// Assign extracted content
		if (euiCardContent.expectedOutcome) data.expectedOutcome = euiCardContent.expectedOutcome;
		if (euiCardContent.objective) data.objective = euiCardContent.objective;
		if (euiCardContent.scope) data.scope = euiCardContent.scope;

		// Fallback if eui-card didn't work
		if (!data.expectedOutcome) {
			data.expectedOutcome = await extractHTMLContent(page, [
				'//h2[contains(text(), "Expected outcome")]/following-sibling::*[1]',
				'//h3[contains(text(), "Expected outcome")]/following-sibling::*[1]',
				'//strong[contains(text(), "Expected outcome")]/following-sibling::*[1]',
				'//span[contains(text(), "Expected Outcome")]/following-sibling::*[1]',
			]);
		}

		if (!data.objective) {
			data.objective = await extractHTMLContent(page, [
				'//h2[contains(text(), "Objective")]/following-sibling::*[1]',
				'//h3[contains(text(), "Objective")]/following-sibling::*[1]',
				'//strong[contains(text(), "Objective")]/following-sibling::*[1]',
				'//span[contains(text(), "Objective")]/following-sibling::*[1]',
			]);
		}

		if (!data.scope) {
			data.scope = await extractHTMLContent(page, [
				'//h2[contains(text(), "Scope")]/following-sibling::*[1]',
				'//h3[contains(text(), "Scope")]/following-sibling::*[1]',
				'//strong[contains(text(), "Scope")]/following-sibling::*[1]',
				'//span[contains(text(), "Scope")]/following-sibling::*[1]',
			]);
		}

		// Budget overview
		data.budgetOverview = await extractTextWithFallback(page, [
			'//dt[contains(text(), "Budget")]/following-sibling::dd[1]',
			'//strong[contains(text(), "Budget")]/../..',
			'//label[contains(text(), "Budget")]/following-sibling::div[1]',
			'//h3[contains(text(), "Budget overview")]/following-sibling::div[1]',
			'//h4[contains(text(), "Budget overview")]/following-sibling::div[1]',
		]);

		// Cleanup: remove null values
		Object.keys(data).forEach((key) => {
			if (!data[key]) delete data[key];
		});

		return data;
	} catch (error) {
		console.warn(
			`⚠️ Error extracting topic description: ${error.message}`,
		);
		return {};
	}
}

async function extractUsefulFilesAndAnnexes(page) {
	try {
		const files = {
			usefulFiles: [],
			annexes: [],
			relatedDocuments: [],
			documents: []
		};

		// Extract links from various containers
		const links = await page.evaluate(() => {
			const results = {
				usefulFiles: [],
				annexes: [],
				relatedDocuments: [],
				documents: []
			};

			const deduplicateByUrl = (arr) => {
				const map = new Map();
				arr.forEach(item => {
					if (item.url && !map.has(item.url)) {
						map.set(item.url, item);
					}
				});
				return Array.from(map.values());
			};

			// Look for "Useful files" section
			const headings = Array.from(document.querySelectorAll('h2, h3, h4, strong, li'));
			const usefulFilesHeading = headings.find(h => 
				h.textContent.toLowerCase().includes('useful file') ||
				h.textContent.toLowerCase().includes('useful document')
			);

			if (usefulFilesHeading) {
				let container = usefulFilesHeading.closest('div, section, li') || usefulFilesHeading.parentElement;
				if (container) {
					const links = container.querySelectorAll('a');
					links.forEach(link => {
						const href = link.getAttribute('href');
						const text = link.textContent.trim();
						if (text && href) {
							results.usefulFiles.push({ title: text, url: href });
						}
					});
				}
			}

			// Look for "Annexes" section
			const annexesHeading = headings.find(h => 
				h.textContent.toLowerCase().includes('annex') ||
				h.textContent.toLowerCase().includes('attachments')
			);

			if (annexesHeading) {
				let container = annexesHeading.closest('div, section, li') || annexesHeading.parentElement;
				if (container) {
					const links = container.querySelectorAll('a');
					links.forEach(link => {
						const href = link.getAttribute('href');
						const text = link.textContent.trim();
						if (text && href) {
							results.annexes.push({ title: text, url: href });
						}
					});
				}
			}

			// Look for "Related Documents" section
			const docsHeading = headings.find(h => 
				h.textContent.toLowerCase().includes('related document') ||
				h.textContent.toLowerCase().includes('further information')
			);

			if (docsHeading) {
				let container = docsHeading.closest('div, section, li') || docsHeading.parentElement;
				if (container) {
					const links = container.querySelectorAll('a');
					links.forEach(link => {
						const href = link.getAttribute('href');
						const text = link.textContent.trim();
						if (text && href) {
							results.relatedDocuments.push({ title: text, url: href });
						}
					});
				}
			}

			// Collect all downloadable links (PDFs, documents)
			const allLinks = document.querySelectorAll('a');
			allLinks.forEach(link => {
				const href = link.getAttribute('href') || '';
				const isDownload = /\.(pdf|doc|docx|xlsx|xls|txt|zip|rar)$/i.test(href);
				const text = link.textContent.trim();
				
				if (isDownload && text && href) {
					results.documents.push({ 
						title: text, 
						url: href,
						type: href.match(/\.([a-z]+)$/i)?.[1]?.toUpperCase() || 'DOCUMENT'
					});
				}
			});

			// Deduplicate all arrays by URL
			results.usefulFiles = deduplicateByUrl(results.usefulFiles);
			results.annexes = deduplicateByUrl(results.annexes);
			results.relatedDocuments = deduplicateByUrl(results.relatedDocuments);
			results.documents = deduplicateByUrl(results.documents);

			return results;
		});

		Object.keys(links).forEach(key => {
			if (links[key].length === 0) delete files[key];
			else files[key] = links[key];
		});

		return files;
	} catch (error) {
		console.warn(`⚠️ Error extracting files and annexes: ${error.message}`);
		return {};
	}
}

async function extractSummaryInformation(page) {
	try {
		const summary = await page.evaluate(() => {
			const data = {};

			// Try to extract summary/overview content
			const summarySelectors = [
				'[class*="summary"]',
				'[id*="summary"]',
				'[class*="overview"]',
				'[id*="overview"]',
				'article',
				'[class*="content"] > div:first-child'
			];

			for (const selector of summarySelectors) {
				const element = document.querySelector(selector);
				if (element) {
					const text = element.textContent.trim();
					if (text.length > 100) {
						data.summary = text.substring(0, 500) + (text.length > 500 ? '...' : '');
						break;
					}
				}
			}

			// Try to extract key information from definition lists or similar structures
			const dts = document.querySelectorAll('dt, strong, label');
			const keyInfo = {};
			
			dts.forEach(dt => {
				const text = dt.textContent.trim();
				if (text.length > 2 && text.length < 50) {
					const dd = dt.nextElementSibling;
					if (dd) {
						const value = dd.textContent.trim();
						if (value && value.length < 200) {
							const sanitizedKey = text.replace(/[.#$/\[\]]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '').trim() || 'unknown';
							keyInfo[sanitizedKey] = value;
						}
					}
				}
			});

			if (Object.keys(keyInfo).length > 0) {
				data.keyInformation = keyInfo;
			}

			return data;
		});

		Object.keys(summary).forEach(key => {
			if (!summary[key]) delete summary[key];
		});

		return summary;
	} catch (error) {
		console.warn(`⚠️ Error extracting summary information: ${error.message}`);
		return {};
	}
}

async function extractTopics(page) {
	try {
		const tableData = await extractTableData(page, "table");

		if (tableData.length > 0) {
			// Deduplicate rows by stringifying them
			const seen = new Set();
			const uniqueRows = tableData.filter(row => {
				const s = JSON.stringify(row);
				if (seen.has(s)) return false;
				seen.add(s);
				return true;
			});
			return uniqueRows;
		}

		return [];
	} catch (error) {
		console.warn(`⚠️ Error extracting topics: ${error.message}`);
		return [];
	}
}

async function extractPartnerSearches(page) {
	try {
		return await page.evaluate(() => {
			const sections = Array.from(
				document.querySelectorAll("h2, h3"),
			);
			const partnerSection = sections.find((s) =>
				s.textContent
					.toLowerCase()
					.includes("partner search"),
			);

			if (!partnerSection) return null;

			const nextContent =
				partnerSection.nextElementSibling;
			if (nextContent) {
				const numberMatch =
					nextContent.textContent.match(/\d+/);
				if (numberMatch) {
					return parseInt(numberMatch[0]);
				}
			}

			const partnerItems = document.querySelectorAll(
				"[class*='partner-search']",
			);
			return partnerItems.length || null;
		});
	} catch (error) {
		console.warn(
			`⚠️ Error extracting partner searches: ${error.message}`,
		);
		return null;
	}
}

async function extractProposalData(page, url) {
	console.log(`\n📄 Processing: ${url}`);

	try {
		await page.goto(url, {
			waitUntil: "networkidle2",
			timeout: 60000,
		});

		console.log("✅ Page loaded");
		await new Promise((r) => setTimeout(r, 2500));

		const generalInfo =
			await extractGeneralInformation(page);
		const topicDesc =
			await extractTopicDescription(page);
		const topics = await extractTopics(page);
		const partnerSearches =
			await extractPartnerSearches(page);
		const filesAndAnnexes =
			await extractUsefulFilesAndAnnexes(page);
		const summary =
			await extractSummaryInformation(page);

		const result = { url: url };

		if (Object.keys(generalInfo).length > 0) {
			result.generalInformation = generalInfo;
		}

		if (Object.keys(topicDesc).length > 0) {
			result.topicDescription = topicDesc;
		}

		if (Object.keys(summary).length > 0) {
			result.summary = summary;
		}

		if (Object.keys(filesAndAnnexes).length > 0) {
			result.filesAndAnnexes = filesAndAnnexes;
		}

		if (topics.length > 0) {
			result.topics = topics;
		}

		if (partnerSearches !== null) {
			result.partnerSearchAnnouncements = {
				number: partnerSearches,
			};
		}

		console.log(`✅ Data extracted`);
		return result;
	} catch (error) {
		console.error(`❌ Error processing URL: ${error.message}`);
		return {
			url: url,
			error: error.message,
		};
	}
}

// ============================================================================
// MAIN EXECUTION
// ============================================================================

(async () => {
	console.log("\n🚀 EU Funding Scraper - Integrated Workflow Started\n");

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

	console.log(`📝 Keyword: "${keyword}"\n`);

	console.log("🌐 Launching browser...");
	const browser = await puppeteer.launch({
		headless: false,
		defaultViewport: null,
		args: ["--start-maximized"],
	});
	console.log("✅ Browser launched");

	const page = await browser.newPage();

	try {
		// PHASE 1: DISCOVER PROPOSALS
		const discoveredUrls = await discoverProposals(page, keyword);

		if (discoveredUrls.length === 0) {
			console.error("❌ No proposals discovered");
			await browser.close();
			process.exit(1);
		}

		// PHASE 2: EXTRACT DETAILS
		console.log("\n" + "=".repeat(70));
		console.log("PHASE 2: DETAILED EXTRACTION");
		console.log("=".repeat(70));

		console.log(
			`📋 Processing ${discoveredUrls.length} proposal(s)...\n`,
		);

		const firebaseEnabled = (process.env.FIREBASE_DATABASE_URL || process.env.FIREBASE_SERVICE_ACCOUNT_PATH || process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
		let currentRunRef = null;
		let successCount = 0;
		let failedItems = [];

		if (firebaseEnabled) {
			console.log('🧹 Clearing old detailed proposals from Firebase...');
			try {
				const { initFirebase } = require('./firebaseClient');
				const admin = initFirebase();
				const db = admin.database();
				
				// Clear old detailed proposals data as requested
				await db.ref('/eu_proposals').remove();
				
				// Create a new run node for the current session
				currentRunRef = db.ref('/eu_proposals').push();
				await currentRunRef.set({
					createdAt: new Date().toISOString(),
					sourceFile: 'live_streaming_run',
					data: {} // We will push results into this node
				});
				console.log(`🚀 New extraction run initialized in Firebase: ${currentRunRef.key}`);
			} catch (e) {
				console.warn('❌ Firebase initialization failed:', e.message);
			}
		}

		const allExtractionResults = [];
		for (let i = 0; i < discoveredUrls.length; i++) {
			const url = discoveredUrls[i];
			console.log(`\n⏳ [${i + 1}/${discoveredUrls.length}] Extracting details...`);

			const result = await extractProposalData(page, url);
			
			if (result.error) {
				failedItems.push({ url, error: result.error });
			} else {
				successCount++;
			}

			// Collect result
			allExtractionResults.push(result);

			if (i < discoveredUrls.length - 1) {
				await new Promise((r) => setTimeout(r, 1000));
			}
		}

		// SAVE AT THE END (As requested)
		if (currentRunRef) {
			try {
				console.log(`\n⬆️ Uploading all ${allExtractionResults.length} records to Firebase...`);
				await currentRunRef.child('data').set(allExtractionResults);
				console.log(`✅ All results uploaded to Firebase`);
			} catch (e) {
				console.warn(`⚠️ Final Firebase save failed: ${e.message}`);
			}
		}

		// SUMMARY
		console.log("\n" + "=".repeat(70));
		console.log("📊 EXECUTION SUMMARY");
		console.log("=".repeat(70));

		console.log(`✅ Total proposals processed: ${discoveredUrls.length}`);
		console.log(`✅ Successful: ${successCount}`);

		if (failedItems.length > 0) {
			console.log(`❌ Failed: ${failedItems.length}`);
			failedItems.forEach((r) => {
				console.log(`   - ${r.url}: ${r.error}`);
			});
		}

		console.log(`${"=".repeat(70)}\n`);
		console.log("🎉 Script completed successfully!");

		if (currentRunRef) {
			console.log(`📡 Data streamed live to Firebase: ${currentRunRef.key}`);
		}

	} catch (error) {
		console.error("\n💥 Fatal error:", error);
	} finally {
		await browser.close();
		process.exit(0);
	}
})();

