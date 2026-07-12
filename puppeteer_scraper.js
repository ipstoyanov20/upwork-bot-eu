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

function getOpportunitiesFrame(page)
{
	const frames = page.frames();
	for (const frame of frames)
	{
		const url = frame.url();
		if (url.includes("opportunities") || url.includes("topic-details") || url.includes("topic-search") || url.includes("calls-for-proposals"))
		{
			return frame;
		}
	}
	return page.mainFrame();
}

function cleanText(text)
{
	if (!text) return null;
	return text
		.trim()
		.replace(/\s+/g, " ")
		.replace(/\n\s*\n/g, "\n");
}

function sanitizeFirebaseKey(key)
{
	if (!key) return 'unknown';
	return key
		.replace(/[.#$/\[\]]/g, '_')
		.replace(/_+/g, '_')
		.replace(/^_|_$/g, '')
		.trim() || 'unknown';
}

function preserveListFormatting(html)
{
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

async function extractTextWithFallback(page, selectors)
{
	if (!Array.isArray(selectors))
	{
		selectors = [selectors];
	}

	for (const selector of selectors)
	{
		try
		{
			let element;

			if (selector.includes("[") || selector.includes("(") || selector.includes("//"))
			{
				const elements = await page.$x(selector);
				element = elements[0] || null;
			} else
			{
				element = await page.$(selector);
			}

			if (element)
			{
				const text = await page.evaluate(
					(el) => el.textContent.trim(),
					element,
				);
				if (text && text.length > 0) return cleanText(text);
			}
		} catch (e)
		{
			continue;
		}
	}

	// Last resort: search for elements containing the keyword
	try
	{
		const lastSelector = selectors[selectors.length - 1];
		const keyword = lastSelector.match(/contains\("([^"]+)"\)/)?.[1] || '';

		if (keyword)
		{
			const found = await page.evaluate((kw) =>
			{
				const elements = Array.from(document.querySelectorAll('*'));
				for (const el of elements)
				{
					if (el.textContent.includes(kw) && el.children.length <= 3)
					{
						const text = el.textContent.trim();
						if (text.length > kw.length)
						{
							return text;
						}
					}
				}
				return null;
			}, keyword);

			if (found) return cleanText(found);
		}
	} catch (e)
	{
		// Silent fail
	}

	return null;
}

async function extractHTMLContent(page, selector)
{
	try
	{
		let element;

		if (selector.includes("["))
		{
			const elements = await page.$x(selector);
			element = elements[0] || null;
		} else
		{
			element = await page.$(selector);
		}

		if (!element) return null;

		const html = await page.evaluate(
			(el) => el.innerHTML,
			element,
		);

		return preserveListFormatting(html);
	} catch (error)
	{
		return null;
	}
}

async function extractTableData(page, tableSelector = "table")
{
	try
	{
		return await page.evaluate((selector) =>
		{
			const table = document.querySelector(selector);
			if (!table) return [];

			const rows = table.querySelectorAll("tbody tr");
			const headers = Array.from(
				table.querySelectorAll("thead th"),
			).map((th) => th.textContent.trim());

			const data = [];
			rows.forEach((row) =>
			{
				const cells = Array.from(row.querySelectorAll("td"));
				const rowData = {};

				cells.forEach((cell, index) =>
				{
					const header = headers[index] || `column_${index}`;
					const value = cell.textContent.trim();
					if (value) rowData[header] = value;
				});

				if (Object.keys(rowData).length > 0)
				{
					data.push(rowData);
				}
			});

			return data;
		}, tableSelector);
	} catch (error)
	{
		return [];
	}
}

// ============================================================================
// SEARCH FUNCTIONS
// ============================================================================

async function findSearchInput(page)
{
	const inputs = await page.$$("input");
	for (const input of inputs)
	{
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
		)
		{
			return input;
		}
	}
	for (const input of inputs)
	{
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

async function discoverProposals(page, keyword)
{
	console.log("\n" + "=".repeat(70));
	console.log("PHASE 1: DISCOVERY");
	console.log("=".repeat(70));

	const searchApiResponses = [];
	page.on('response', async (response) => {
		if (response.url().includes('api.tech.ec.europa.eu/search-api/prod/rest/search') && response.status() === 200) {
			try {
				const json = await response.json();
				if (json) {
					searchApiResponses.push(json);
				}
			} catch (e) {
				// ignore
			}
		}
	});

	const URL =
		"https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/opportunities/calls-for-proposals";

	console.log(`📍 Navigating to: ${URL}`);
	await page.goto(URL, { waitUntil: "networkidle2" });
	console.log("✅ Page loaded");

	console.log("⏳ Waiting for opportunities frame to load...");
	let targetFrame = null;
	const frameTimeout = 25000;
	const frameStartTime = Date.now();
	while (Date.now() - frameStartTime < frameTimeout)
	{
		targetFrame = getOpportunitiesFrame(page);
		if (targetFrame && targetFrame !== page.mainFrame() && targetFrame.url() !== URL)
		{
			break;
		}
		await new Promise((r) => setTimeout(r, 1000));
	}

	if (!targetFrame)
	{
		console.warn("⚠️ Opportunities frame not found, falling back to main page frame.");
		targetFrame = page.mainFrame();
	} else
	{
		console.log(`✅ Opportunities frame detected: ${targetFrame.url()}`);
	}

	console.log("🔍 Waiting for search input to be available inside target frame...");
	let inputFocused = false;
	const inputTimeout = 20000;
	const inputStartTime = Date.now();

	while (Date.now() - inputStartTime < inputTimeout)
	{
		inputFocused = await targetFrame.evaluate(() =>
		{
			function findInputsDeep(root = document)
			{
				const queue = [root];
				const inputs = [];
				while (queue.length > 0)
				{
					const node = queue.shift();
					if (!node) continue;
					if (node.nodeType === Node.ELEMENT_NODE)
					{
						if (node.tagName === 'INPUT')
						{
							inputs.push(node);
						}
						if (node.shadowRoot)
						{
							queue.push(node.shadowRoot);
						}
					}
					if (node.childNodes)
					{
						for (let i = 0; i < node.childNodes.length; i++)
						{
							queue.push(node.childNodes[i]);
						}
					}
				}
				return inputs;
			}

			const allInputs = findInputsDeep();
			let targetInput = null;

			// 1. Try to find by search attributes
			for (const input of allInputs)
			{
				const type = (input.type || "").toLowerCase();
				const name = (input.name || "").toLowerCase();
				const id = (input.id || "").toLowerCase();
				const placeholder = (input.placeholder || "").toLowerCase();
				const className = (input.className || "").toLowerCase();
				const combined = (type + " " + name + " " + id + " " + placeholder + " " + className);

				if (type === "search" || /search|keyword|keywords|q|query/.test(combined))
				{
					targetInput = input;
					break;
				}
			}

			// 2. Fallback to text inputs
			if (!targetInput)
			{
				for (const input of allInputs)
				{
					const type = (input.type || "").toLowerCase();
					if (type === "text" || type === "")
					{
						targetInput = input;
						break;
					}
				}
			}

			if (targetInput)
			{
				targetInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
				targetInput.focus();
				if (targetInput.select) targetInput.select();
				return true;
			}
			return false;
		});

		if (inputFocused)
		{
			break;
		}
		await new Promise((r) => setTimeout(r, 1000));
	}

	if (inputFocused)
	{
		console.log("✅ Search input focused");
		console.log(`⌨️ Typing keyword: "${keyword}"`);
		await page.keyboard.type(keyword, { delay: 100 });
		await page.keyboard.press("Enter");
		console.log(`✅ Typed keyword "${keyword}" and pressed Enter.`);
		await new Promise((r) => setTimeout(r, 4000));
	} else
	{
		console.warn("⚠️ Could not locate or focus search input on the page after timeout. Proceeding...");
	}

	// Click "Accept all cookies" button
	console.log("🍪 Looking for cookie consent button...");
	try
	{
		const cookieClicked = await page.evaluate(() =>
		{
			const els = Array.from(document.querySelectorAll("button, span, a"));
			const target = els.find(el => (el.textContent || "").toLowerCase().includes("accept all cookies"));
			if (target)
			{
				target.scrollIntoView({ behavior: 'smooth', block: 'center' });
				target.click();
				return true;
			}
			return false;
		});
		if (cookieClicked)
		{
			console.log("✅ Cookie consent button clicked");
		} else
		{
			console.log("⚠️ Cookie consent button not found or already accepted");
		}
	} catch (e)
	{
		console.warn("⚠️ Error checking cookie consent:", e.message || e);
	}

	console.log("⏳ Waiting for page elements to load...");
	await new Promise((r) => setTimeout(r, 4000));
	console.log("✅ Page elements loaded");
	await new Promise((r) => setTimeout(r, 5000));

	// Define robust helper inside discoverProposals to click elements in any frame/shadow DOM
	async function waitForAndClickDeep(text, timeout = 30000)
	{
		console.log(`⏳ Waiting for element containing text "${text}" (deep check across all frames)...`);

		const startTime = Date.now();
		let targetElementFrame = null;

		while (Date.now() - startTime < timeout)
		{
			const frames = page.frames();
			for (const frame of frames)
			{
				try
				{
					const hasText = await frame.evaluate((txt) =>
					{
						function hasTextDeep(txtToFind, root = document)
						{
							const target = txtToFind.toLowerCase();
							const queue = [root];
							while (queue.length > 0)
							{
								const node = queue.shift();
								if (!node) continue;
								if (node.nodeType === Node.ELEMENT_NODE)
								{
									if ((node.textContent || "").toLowerCase().includes(target))
									{
										return true;
									}
									if (node.shadowRoot)
									{
										queue.push(node.shadowRoot);
									}
								}
								if (node.childNodes)
								{
									for (let i = 0; i < node.childNodes.length; i++)
									{
										queue.push(node.childNodes[i]);
									}
								}
							}
							return false;
						}
						return hasTextDeep(txt);
					}, text);

					if (hasText)
					{
						targetElementFrame = frame;
						break;
					}
				} catch (e)
				{
					// ignore
				}
			}

			if (targetElementFrame)
			{
				break;
			}

			await new Promise((r) => setTimeout(r, 1000));
		}

		if (!targetElementFrame)
		{
			throw new Error(`TimeoutError: Waiting failed: element containing "${text}" not found in any frame after ${timeout}ms`);
		}

		console.log(`✅ Element containing "${text}" found in frame: ${targetElementFrame.url()}`);

		// Scroll and click the element inside the found frame
		const clicked = await targetElementFrame.evaluate((textToFind) =>
		{
			function findDeep(txt, root = document)
			{
				const targetText = txt.trim().toLowerCase();
				const queue = [root];
				const candidates = [];

				while (queue.length > 0)
				{
					const node = queue.shift();
					if (!node) continue;

					if (node.nodeType === Node.ELEMENT_NODE)
					{
						const text = (node.textContent || "").trim().toLowerCase();

						if (text.includes(targetText))
						{
							candidates.push(node);
						}

						if (node.shadowRoot)
						{
							queue.push(node.shadowRoot);
						}
					}

					if (node.childNodes && node.childNodes.length > 0)
					{
						for (let i = 0; i < node.childNodes.length; i++)
						{
							queue.push(node.childNodes[i]);
						}
					}
				}

				if (candidates.length > 0)
				{
					const specificTags = ["BUTTON", "SPAN", "A", "INPUT", "LABEL", "EUI-BUTTON", "EUI-CHECKBOX"];
					const filtered = candidates.filter(el => specificTags.includes(el.tagName));
					const list = filtered.length > 0 ? filtered : candidates;
					list.sort((a, b) => (a.textContent || "").trim().length - (b.textContent || "").trim().length);
					return list[0];
				}
				return null;
			}

			const el = findDeep(textToFind);
			if (el)
			{
				el.scrollIntoView({ behavior: 'smooth', block: 'center' });

				// Walk up parents to see if there is an ancestor button/link/eui-button to click instead of nested text span
				let clickTarget = el;
				let current = el;
				for (let i = 0; i < 5; i++)
				{
					if (!current) break;
					const tag = current.tagName;
					if (tag === 'BUTTON' || tag === 'A' || tag === 'EUI-BUTTON' || current.getAttribute('role') === 'button')
					{
						clickTarget = current;
						break;
					}
					current = current.parentElement;
				}

				const input = clickTarget.tagName === 'INPUT' ? clickTarget : clickTarget.querySelector('input') || (clickTarget.parentElement ? clickTarget.parentElement.querySelector('input') : null);
				if (input)
				{
					input.click();
				} else
				{
					clickTarget.click();
					clickTarget.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
				}
				return true;
			}
			return false;
		}, text);

		if (clicked)
		{
			console.log(`✅ Clicked element containing "${text}"`);
		} else
		{
			throw new Error(`Could not click element containing "${text}"`);
		}
	}

	// Helper to ensure checkbox state inside any frame/shadow DOM
	async function ensureCheckboxStateDeep(labelText, shouldBeChecked)
	{
		console.log(`⏳ Ensuring checkbox for "${labelText}" is ${shouldBeChecked ? "checked" : "unchecked"}...`);

		let targetElementFrame = null;
		const frames = page.frames();
		for (const frame of frames)
		{
			try
			{
				const hasText = await frame.evaluate((txt) =>
				{
					function hasTextDeep(txtToFind, root = document)
					{
						const target = txtToFind.toLowerCase();
						const queue = [root];
						while (queue.length > 0)
						{
							const node = queue.shift();
							if (!node) continue;
							if (node.nodeType === Node.ELEMENT_NODE)
							{
								if ((node.textContent || "").toLowerCase().includes(target))
								{
									return true;
								}
								if (node.shadowRoot)
								{
									queue.push(node.shadowRoot);
								}
							}
							if (node.childNodes)
							{
								for (let i = 0; i < node.childNodes.length; i++)
								{
									queue.push(node.childNodes[i]);
								}
							}
						}
						return false;
					}
					return hasTextDeep(txt);
				}, labelText);

				if (hasText)
				{
					targetElementFrame = frame;
					break;
				}
			} catch (e)
			{
				// ignore
			}
		}

		if (!targetElementFrame)
		{
			console.warn(`⚠️ Checkbox containing "${labelText}" not found in any frame.`);
			return;
		}

		const toggled = await targetElementFrame.evaluate((txt, targetState) =>
		{
			function findDeep(txtToFind, root = document)
			{
				const targetText = txtToFind.trim().toLowerCase();
				const queue = [root];
				const candidates = [];

				while (queue.length > 0)
				{
					const node = queue.shift();
					if (!node) continue;

					if (node.nodeType === Node.ELEMENT_NODE)
					{
						const text = (node.textContent || "").trim().toLowerCase();

						if (text.includes(targetText))
						{
							candidates.push(node);
						}

						if (node.shadowRoot)
						{
							queue.push(node.shadowRoot);
						}
					}

					if (node.childNodes && node.childNodes.length > 0)
					{
						for (let i = 0; i < node.childNodes.length; i++)
						{
							queue.push(node.childNodes[i]);
						}
					}
				}

				if (candidates.length > 0)
				{
					const specificTags = ["LABEL", "SPAN", "INPUT", "EUI-CHECKBOX", "BUTTON"];
					const filtered = candidates.filter(el => specificTags.includes(el.tagName));
					const list = filtered.length > 0 ? filtered : candidates;
					list.sort((a, b) => (a.textContent || "").trim().length - (b.textContent || "").trim().length);
					return list[0];
				}
				return null;
			}

			const el = findDeep(txt);
			if (!el) return false;

			el.scrollIntoView({ behavior: 'smooth', block: 'center' });

			let checkboxInput = null;
			if (el.tagName === 'INPUT' && el.type === 'checkbox')
			{
				checkboxInput = el;
			} else
			{
				checkboxInput = el.querySelector('input[type="checkbox"]') ||
					(el.parentElement ? el.parentElement.querySelector('input[type="checkbox"]') : null);
			}

			let isChecked = false;
			let customCheckbox = null;

			let current = el;
			for (let i = 0; i < 5; i++)
			{
				if (!current) break;
				if (current.tagName === 'EUI-CHECKBOX' || current.tagName === 'MAT-CHECKBOX' || current.getAttribute('role') === 'checkbox')
				{
					customCheckbox = current;
					break;
				}
				current = current.parentElement;
			}

			if (checkboxInput)
			{
				isChecked = checkboxInput.checked;
			} else if (customCheckbox)
			{
				const ariaChecked = customCheckbox.getAttribute('aria-checked');
				const classes = customCheckbox.className || '';
				isChecked = ariaChecked === 'true' || classes.includes('checked') || classes.includes('is-checked');
			} else
			{
				const classes = el.className || '';
				isChecked = classes.includes('checked') || classes.includes('is-checked');
			}

			if (isChecked !== targetState)
			{
				if (checkboxInput)
				{
					checkboxInput.click();
				} else if (customCheckbox)
				{
					customCheckbox.click();
					customCheckbox.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
				} else
				{
					el.click();
					el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
				}
				return true; // Toggled
			}
			return null; // Already in correct state
		}, labelText, shouldBeChecked);

		return toggled;
	}

	// 1. Make sure only "Open for submission" is checked (the accordion is usually open by default now)
	await new Promise((r) => setTimeout(r, 2000));

	// 2. Make sure only "Open for submission" is checked
	await ensureCheckboxStateDeep("open for submission", true);
	await ensureCheckboxStateDeep("forthcoming", false);
	await ensureCheckboxStateDeep("closed", false);

	console.log("⏳ Waiting for filters UI to update...");
	await new Promise((r) => setTimeout(r, 1500));

	// 3. Click "View results" if present (some viewport layouts might render it), otherwise proceed
	try
	{
		console.log("🔎 Checking if 'View results' button is present on screen...");
		await waitForAndClickDeep("view results", 5000);
	} catch (e)
	{
		console.log("ℹ️ 'View results' button not found, results auto-applied via direct sidebar checkboxes.");
	}

	await new Promise((r) => setTimeout(r, 3000));

	console.log("📊 Extracting total items count...");
	let totalItemsFound = 0;
	try
	{
		await targetFrame.waitForSelector('strong', { timeout: 5000 });
		totalItemsFound = await targetFrame.evaluate(() =>
		{
			const containers = document.querySelectorAll('div[class*="col-sm"], div[class*="col-lg"], div[class*="col-xl"]');
			for (const container of containers)
			{
				if (container.textContent.includes('item(s) found'))
				{
					const strong = container.querySelector('strong');
					if (strong)
					{
						return parseInt(strong.textContent.trim(), 10) || 0;
					}
				}
			}
			return 0;
		});
		console.log(`✅ Total items found: ${totalItemsFound}`);
	} catch (e)
	{
		console.log("⚠️ Could not extract total items count");
	}

	console.log("📜 Scrolling to bottom of page...");
	await targetFrame.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
	await new Promise((r) => setTimeout(r, 1000));

	console.log("🔢 Changing pagination size to 100...");
	try
	{
		await targetFrame.waitForSelector('select.page-size__select', { timeout: 5000 });
		const responseCountBefore = searchApiResponses.length;
		await targetFrame.select('select.page-size__select', '100');
		await targetFrame.evaluate(() =>
		{
			const select = document.querySelector('select.page-size__select');
			if (select)
			{
				select.dispatchEvent(new Event('change', { bubbles: true }));
			}
		});
		console.log("✅ Page size set to 100");
		
		let waitTime = 0;
		while(searchApiResponses.length === responseCountBefore && waitTime < 10000) {
			await new Promise(r => setTimeout(r, 500));
			waitTime += 500;
		}
		await new Promise((r) => setTimeout(r, 1000));
	} catch (e)
	{
		console.log("⚠️ Could not change pagination size, continuing with default");
	}

	const allResults = [];

	const extractCurrentPageResultsFromAPI = async () =>
	{
		await new Promise(r => setTimeout(r, 1000)); // give a bit of time
		if (searchApiResponses.length === 0) return [];
		const latest = searchApiResponses[searchApiResponses.length - 1];
		let items = [];
		if (latest.results) {
			items = latest.results;
		} else if (latest.hits && latest.hits.hits) {
			items = latest.hits.hits;
		} else if (Array.isArray(latest)) {
			items = latest;
		}

		const extracted = [];
		for (const item of items) {
			let identifier = null;
			let title = "N/A";
			
			if (item.metadata && item.metadata.identifier) {
				identifier = Array.isArray(item.metadata.identifier) ? item.metadata.identifier[0] : item.metadata.identifier;
			} else if (item.identifier) {
				identifier = Array.isArray(item.identifier) ? item.identifier[0] : item.identifier;
			}
			
			if (item.metadata && item.metadata.title) {
				title = Array.isArray(item.metadata.title) ? item.metadata.title[0] : item.metadata.title;
			}

			if (identifier) {
				extracted.push({
					title: title,
					href: `https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/opportunities/topic-details/${identifier}?keywords=${encodeURIComponent(keyword)}`,
					topicCode: identifier,
					openingDate: "N/A",
					deadlineDate: "N/A",
				});
			}
		}
		return extracted;
	};

	console.log("📄 Checking for pagination...");
	const paginationButtons = await targetFrame.$$('div.eui-paginator__page-navigation-numbers button');
	const totalPages = paginationButtons.length;
	console.log(`✅ Found ${totalPages > 0 ? totalPages : 1} page(s)`);

	if (totalPages > 1)
	{
		for (let pageNum = 1; pageNum <= totalPages; pageNum++)
		{
			console.log(`\n📖 Processing page ${pageNum} of ${totalPages}...`);

			if (pageNum > 1)
			{
				const pageButtons = await targetFrame.$$('div.eui-paginator__page-navigation-numbers button');
				const targetButton = pageButtons[pageNum - 1];
				if (targetButton)
				{
					const responseCountBefore = searchApiResponses.length;
					await targetButton.click();
					
					let waitTime = 0;
					while(searchApiResponses.length === responseCountBefore && waitTime < 10000) {
						await new Promise(r => setTimeout(r, 500));
						waitTime += 500;
					}
					await new Promise((r) => setTimeout(r, 1000));
				}
			}

			const pageResults = await extractCurrentPageResultsFromAPI();
			allResults.push(...pageResults);
			console.log(`✅ Extracted ${pageResults.length} results from page ${pageNum}`);
		}
	} else
	{
		const pageResults = await extractCurrentPageResultsFromAPI();
		allResults.push(...pageResults);
	}

	// Deduplicate discovery results by URL
	const uniqueResultsMap = new Map();
	allResults.forEach(r =>
	{
		if (r.href && r.href !== 'N/A' && !uniqueResultsMap.has(r.href))
		{
			uniqueResultsMap.set(r.href, r);
		}
	});
	const results = Array.from(uniqueResultsMap.values());

	console.log(`\n✅ Found ${results.length} unique proposals (Total reported: ${totalItemsFound})`);
	results.forEach((result, index) =>
	{
		console.log(`\n📋 Result ${index + 1}:`);
		console.log(`   Title: ${result.title}`);
		console.log(`   Code: ${result.topicCode}`);
		console.log(`   Opening: ${result.openingDate}`);
		console.log(`   Deadline: ${result.deadlineDate}`);
		console.log(`   URL: ${result.href}`);
	});

	try
	{
		if (process.env.FIREBASE_DATABASE_URL || process.env.FIREBASE_SERVICE_ACCOUNT_PATH || process.env.FIREBASE_SERVICE_ACCOUNT_JSON)
		{
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
	} catch (e)
	{
		console.warn('⚠️ Firebase discovery upload failed:', e.message || e);
	}

	// Try minimal local file write - wrap in try/catch to avoid fatal error if disk is full
	try
	{
		const discoveryFile = path.join(__dirname, "proposal_discovery_results.json");
		fs.writeFileSync(discoveryFile, JSON.stringify(results, null, 2), "utf8");
		console.log(`💾 Discovery results saved locally.`);
	} catch (e)
	{
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

async function extractGeneralInformation(page)
{
	try
	{
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

		Object.keys(data).forEach((key) =>
		{
			if (!data[key]) delete data[key];
		});

		return data;
	} catch (error)
	{
		console.warn(
			`⚠️ Error extracting general information: ${error.message}`,
		);
		return {};
	}
}

async function extractTopicDescription(page)
{
	try
	{
		const data = {
			expectedOutcome: null,
			objective: null,
			scope: null,
			budgetOverview: null,
			specificContent: null,
		};

		// Try to extract from eui-card structure with topicdescriptionkind spans
		const euiCardContent = await page.evaluate(() =>
		{
			const result = {};

			// Find all topicdescriptionkind spans
			const spans = Array.from(document.querySelectorAll('span.topicdescriptionkind, .topicdescriptionkind'));

			spans.forEach(span =>
			{
				const text = span.textContent.trim().toLowerCase().replace(':', '');
				let content = null;

				// Get the next element(s) after the span
				let nextEl = span.nextElementSibling;

				if (nextEl)
				{
					if (nextEl.tagName === 'UL')
					{
						// For lists, collect all li items
						const items = Array.from(nextEl.querySelectorAll('li')).map(li => li.textContent.trim());
						content = items.join('\n• ');
						if (content) content = '• ' + content;
					} else if (nextEl.tagName === 'P')
					{
						// For paragraphs, get text
						content = nextEl.textContent.trim();
					} else
					{
						// Try to get text from next element or siblings
						content = nextEl.textContent.trim();
					}
				}

				if (text.includes('expected outcome'))
				{
					result.expectedOutcome = content;
				} else if (text.includes('objective'))
				{
					result.objective = content;
				} else if (text.includes('scope'))
				{
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
		if (!data.expectedOutcome)
		{
			data.expectedOutcome = await extractHTMLContent(page, [
				'//h2[contains(text(), "Expected outcome")]/following-sibling::*[1]',
				'//h3[contains(text(), "Expected outcome")]/following-sibling::*[1]',
				'//strong[contains(text(), "Expected outcome")]/following-sibling::*[1]',
				'//span[contains(text(), "Expected Outcome")]/following-sibling::*[1]',
			]);
		}

		if (!data.objective)
		{
			data.objective = await extractHTMLContent(page, [
				'//h2[contains(text(), "Objective")]/following-sibling::*[1]',
				'//h3[contains(text(), "Objective")]/following-sibling::*[1]',
				'//strong[contains(text(), "Objective")]/following-sibling::*[1]',
				'//span[contains(text(), "Objective")]/following-sibling::*[1]',
			]);
		}

		if (!data.scope)
		{
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
		Object.keys(data).forEach((key) =>
		{
			if (!data[key]) delete data[key];
		});

		return data;
	} catch (error)
	{
		console.warn(
			`⚠️ Error extracting topic description: ${error.message}`,
		);
		return {};
	}
}

async function extractUsefulFilesAndAnnexes(page)
{
	try
	{
		const files = {
			usefulFiles: [],
			annexes: [],
			relatedDocuments: [],
			documents: []
		};

		// Extract links from various containers
		const links = await page.evaluate(() =>
		{
			const results = {
				usefulFiles: [],
				annexes: [],
				relatedDocuments: [],
				documents: []
			};

			const deduplicateByUrl = (arr) =>
			{
				const map = new Map();
				arr.forEach(item =>
				{
					if (item.url && !map.has(item.url))
					{
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

			if (usefulFilesHeading)
			{
				let container = usefulFilesHeading.closest('div, section, li') || usefulFilesHeading.parentElement;
				if (container)
				{
					const links = container.querySelectorAll('a');
					links.forEach(link =>
					{
						const href = link.getAttribute('href');
						const text = link.textContent.trim();
						if (text && href)
						{
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

			if (annexesHeading)
			{
				let container = annexesHeading.closest('div, section, li') || annexesHeading.parentElement;
				if (container)
				{
					const links = container.querySelectorAll('a');
					links.forEach(link =>
					{
						const href = link.getAttribute('href');
						const text = link.textContent.trim();
						if (text && href)
						{
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

			if (docsHeading)
			{
				let container = docsHeading.closest('div, section, li') || docsHeading.parentElement;
				if (container)
				{
					const links = container.querySelectorAll('a');
					links.forEach(link =>
					{
						const href = link.getAttribute('href');
						const text = link.textContent.trim();
						if (text && href)
						{
							results.relatedDocuments.push({ title: text, url: href });
						}
					});
				}
			}

			// Collect all downloadable links (PDFs, documents)
			const allLinks = document.querySelectorAll('a');
			allLinks.forEach(link =>
			{
				const href = link.getAttribute('href') || '';
				const isDownload = /\.(pdf|doc|docx|xlsx|xls|txt|zip|rar)$/i.test(href);
				const text = link.textContent.trim();

				if (isDownload && text && href)
				{
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

		Object.keys(links).forEach(key =>
		{
			if (links[key].length === 0) delete files[key];
			else files[key] = links[key];
		});

		return files;
	} catch (error)
	{
		console.warn(`⚠️ Error extracting files and annexes: ${error.message}`);
		return {};
	}
}

async function extractSummaryInformation(page)
{
	try
	{
		const summary = await page.evaluate(() =>
		{
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

			for (const selector of summarySelectors)
			{
				const element = document.querySelector(selector);
				if (element)
				{
					const text = element.textContent.trim();
					if (text.length > 100)
					{
						data.summary = text.substring(0, 500) + (text.length > 500 ? '...' : '');
						break;
					}
				}
			}

			// Try to extract key information from definition lists or similar structures
			const dts = document.querySelectorAll('dt, strong, label');
			const keyInfo = {};

			dts.forEach(dt =>
			{
				const text = dt.textContent.trim();
				if (text.length > 2 && text.length < 50)
				{
					const dd = dt.nextElementSibling;
					if (dd)
					{
						const value = dd.textContent.trim();
						if (value && value.length < 200)
						{
							const sanitizedKey = text.replace(/[.#$/\[\]]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '').trim() || 'unknown';
							keyInfo[sanitizedKey] = value;
						}
					}
				}
			});

			if (Object.keys(keyInfo).length > 0)
			{
				data.keyInformation = keyInfo;
			}

			return data;
		});

		Object.keys(summary).forEach(key =>
		{
			if (!summary[key]) delete summary[key];
		});

		return summary;
	} catch (error)
	{
		console.warn(`⚠️ Error extracting summary information: ${error.message}`);
		return {};
	}
}

async function extractTopics(page)
{
	try
	{
		const tableData = await extractTableData(page, "table");

		if (tableData.length > 0)
		{
			// Deduplicate rows by stringifying them
			const seen = new Set();
			const uniqueRows = tableData.filter(row =>
			{
				const s = JSON.stringify(row);
				if (seen.has(s)) return false;
				seen.add(s);
				return true;
			});
			return uniqueRows;
		}

		return [];
	} catch (error)
	{
		console.warn(`⚠️ Error extracting topics: ${error.message}`);
		return [];
	}
}

async function extractPartnerSearches(page)
{
	try
	{
		return await page.evaluate(() =>
		{
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
			if (nextContent)
			{
				const numberMatch =
					nextContent.textContent.match(/\d+/);
				if (numberMatch)
				{
					return parseInt(numberMatch[0]);
				}
			}

			const partnerItems = document.querySelectorAll(
				"[class*='partner-search']",
			);
			return partnerItems.length || null;
		});
	} catch (error)
	{
		console.warn(
			`⚠️ Error extracting partner searches: ${error.message}`,
		);
		return null;
	}
}

async function extractProposalData(page, url)
{
	console.log(`\n📄 Processing: ${url}`);

	try
	{
		await page.goto(url, {
			waitUntil: "networkidle2",
			timeout: 60000,
		});

		console.log("✅ Page loaded");
		await new Promise((r) => setTimeout(r, 2500));

		console.log("⏳ Waiting for details frame to load...");
		let targetFrame = null;
		const frameTimeout = 25000;
		const frameStartTime = Date.now();
		while (Date.now() - frameStartTime < frameTimeout)
		{
			targetFrame = getOpportunitiesFrame(page);
			if (targetFrame && targetFrame !== page.mainFrame() && targetFrame.url() !== url)
			{
				break;
			}
			await new Promise((r) => setTimeout(r, 1000));
		}

		if (!targetFrame)
		{
			console.warn("⚠️ Opportunities details frame not found, falling back to main page frame.");
			targetFrame = page.mainFrame();
		} else
		{
			console.log(`✅ Opportunities details frame detected: ${targetFrame.url()}`);
		}

		const generalInfo =
			await extractGeneralInformation(targetFrame);
		const topicDesc =
			await extractTopicDescription(targetFrame);
		const topics = await extractTopics(targetFrame);
		const partnerSearches =
			await extractPartnerSearches(targetFrame);
		const filesAndAnnexes =
			await extractUsefulFilesAndAnnexes(targetFrame);
		const summary =
			await extractSummaryInformation(targetFrame);

		const result = { url: url };

		if (Object.keys(generalInfo).length > 0)
		{
			result.generalInformation = generalInfo;
		}

		if (Object.keys(topicDesc).length > 0)
		{
			result.topicDescription = topicDesc;
		}

		if (Object.keys(summary).length > 0)
		{
			result.summary = summary;
		}

		if (Object.keys(filesAndAnnexes).length > 0)
		{
			result.filesAndAnnexes = filesAndAnnexes;
		}

		if (topics.length > 0)
		{
			result.topics = topics;
		}

		if (partnerSearches !== null)
		{
			result.partnerSearchAnnouncements = {
				number: partnerSearches,
			};
		}

		console.log(`✅ Data extracted`);
		return result;
	} catch (error)
	{
		console.error(`❌ Error processing URL: ${error.message}`);
		return {
			url: url,
			error: error.message,
		};
	}
}

// ============================================================================
// MAIN EXECUTION (BATCH MODE)
// ============================================================================

(async () =>
{
	console.log("\n🚀 EU Funding Scraper - Batch Workflow Started\n");

	const keyword =
		process.argv.slice(2).join(" ") ||
		(await (async () =>
		{
			process.stdout.write("Enter search keyword: ");
			return await new Promise((resolve) =>
			{
				process.stdin.resume();
				process.stdin.once("data", (data) =>
				{
					process.stdin.pause();
					resolve(data.toString().trim());
				});
			});
		})());

	if (!keyword)
	{
		console.log("No keyword provided. Fetching all results without keyword filter.");
	}

	console.log(`📝 Keyword: "${keyword}"\n`);

	console.log("🌐 Launching browser...");
	const browser = await puppeteer.launch({
		headless: process.env.HEADLESS === "true" || process.env.HEADLESS === "new" ? 'new' : false,
		defaultViewport: null,
		args: ["--start-maximized"],
	});
	console.log("✅ Browser launched");

	const page = await browser.newPage();
	const firebaseEnabled = (process.env.FIREBASE_DATABASE_URL || process.env.FIREBASE_SERVICE_ACCOUNT_PATH || process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
	let currentRunRef = null;
	let db = null;

	if (firebaseEnabled)
	{
		console.log('🧹 Clearing old detailed proposals from Firebase...');
		try
		{
			const { initFirebase } = require('./firebaseClient');
			const admin = initFirebase();
			db = admin.database();

			await db.ref('/eu_proposals').remove();

			currentRunRef = db.ref('/eu_proposals').push();
			await currentRunRef.set({
				createdAt: new Date().toISOString(),
				sourceFile: 'batch_run',
				data: {} 
			});
			console.log(`🚀 New extraction run initialized in Firebase: ${currentRunRef.key}`);
		} catch (e)
		{
			console.warn('❌ Firebase initialization failed:', e.message);
		}
	}

	let successCount = 0;
	let failedItems = [];
	let allExtractionResults = [];

	try
	{
		// PHASE 1: NAVIGATE AND FILTER
		console.log("\n" + "=".repeat(70));
		console.log("PHASE 1: NAVIGATE AND FILTER");
		console.log("=".repeat(70));

		const searchApiResponses = [];
		page.on('response', async (response) => {
			if (response.url().includes('api.tech.ec.europa.eu/search-api/prod/rest/search') && response.status() === 200) {
				try {
					const json = await response.json();
					if (json) {
						searchApiResponses.push(json);
					}
				} catch (e) {
					// ignore
				}
			}
		});
		
		let URL = "https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/opportunities/calls-for-proposals?order=DESC&pageNumber=1&pageSize=50&sortBy=relevance&isExactMatch=true&status=31094502";
		if (keyword && keyword.trim() !== "") {
			URL += "&keywords=" + encodeURIComponent(keyword);
		}
		
		console.log(`📍 Navigating to direct search URL: ${URL}`);
		await page.goto(URL, { waitUntil: "networkidle2", timeout: 60000 });
		console.log("✅ Page loaded");

		// Accept cookies
		console.log("🍪 Looking for cookie consent button...");
		await page.evaluate(() => {
			const els = Array.from(document.querySelectorAll("button, span, a"));
			const target = els.find(el => (el.textContent || "").toLowerCase().includes("accept all cookies"));
			if (target) target.click();
		});
		await new Promise(r => setTimeout(r, 2000));

		// Wait for the results to finish loading
		console.log("⏳ Waiting for search results to load...");
		await page.waitForFunction(() => {
			return document.querySelectorAll('a.eui-u-text-link, a.eui-u-font-l').length > 0 || 
			       document.querySelector('.eui-paginator') !== null;
		}, { timeout: 5000 }).catch(() => console.log("⚠️ Initial load timeout reached, proceeding..."));
		await new Promise(r => setTimeout(r, 2000));
		
		// PHASE 2: EXTRACT URLS FROM INTERCEPTED API
		console.log("\n" + "=".repeat(70));
		console.log("PHASE 2: EXTRACT URLS FROM INTERCEPTED API");
		console.log("=".repeat(70));
		
		let allProposalLinks = [];
		if (searchApiResponses.length > 0) {
			const latest = searchApiResponses[searchApiResponses.length - 1];
			let items = [];
			if (latest.results) {
				items = latest.results;
			} else if (latest.hits && latest.hits.hits) {
				items = latest.hits.hits;
			} else if (Array.isArray(latest)) {
				items = latest;
			}

			for (const item of items) {
				if (item.url) {
					allProposalLinks.push(item.url);
				} else {
					let identifier = null;
					if (item.metadata && item.metadata.identifier) {
						identifier = Array.isArray(item.metadata.identifier) ? item.metadata.identifier[0] : item.metadata.identifier;
					} else if (item.identifier) {
						identifier = Array.isArray(item.identifier) ? item.identifier[0] : item.identifier;
					}
					if (identifier) {
						allProposalLinks.push(`https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/opportunities/topic-details/${identifier}?keywords=${encodeURIComponent(keyword || '')}`);
					}
				}
			}
			console.log(`✅ Extracted a total of ${allProposalLinks.length} unique proposal links from API.`);
		} else {
			console.warn("⚠️ No API responses were intercepted! Check if the page loaded correctly.");
		}
		
		// Save links locally
		const linksPath = require('path').join(__dirname, "all_collected_links.json");
		require('fs').writeFileSync(linksPath, JSON.stringify(allProposalLinks, null, 2), "utf8");
		console.log(`💾 Saved all links locally to all_collected_links.json`);

		// PHASE 3: PROCESS IN BATCHES OF 50
		console.log("\n" + "=".repeat(70));
		console.log("PHASE 3: BATCH PROCESSING & UPLOADING");
		console.log("=".repeat(70));

		let batchResults = [];
		const BATCH_SIZE = 50;

		for (let i = 0; i < allProposalLinks.length; i++) {
			const url = allProposalLinks[i];
			console.log(`\n⏳ [${i + 1}/${allProposalLinks.length}] Extracting details...`);
			console.log(`   URL: ${url}`);
			
			const newTab = await browser.newPage();
			try {
				const result = await extractProposalData(newTab, url);
				
				if (result.error) {
					failedItems.push({ url, error: result.error });
				} else {
					successCount++;
				}
				
				batchResults.push(result);
				allExtractionResults.push(result);
				
			} catch(err) {
				console.error(`❌ Failed to process tab: ${err.message}`);
				failedItems.push({ url, error: err.message });
			} finally {
				await newTab.close();
			}

			// If we reached batch size or end of list
			if (batchResults.length === BATCH_SIZE || i === allProposalLinks.length - 1) {
				console.log(`\n📦 Batch of ${batchResults.length} reached. Saving to temporary file...`);
				
				const tempBatchPath = require('path').join(__dirname, "temp_batch.json");
				require('fs').writeFileSync(tempBatchPath, JSON.stringify(batchResults, null, 2), "utf8");
				
				if (currentRunRef) {
					console.log(`📡 Uploading batch information to Firebase database...`);
					for(const res of batchResults) {
						await currentRunRef.child('data').push(res);
					}
					console.log(`✅ Upload complete.`);
				}
				
				console.log(`🧹 Clearing temporary text file for the next batch...`);
				require('fs').writeFileSync(tempBatchPath, JSON.stringify([], null, 2), "utf8");
				
				// Clear batch array in memory
				batchResults = [];
			}
		}

		console.log("\n" + "=".repeat(70));
		console.log("📊 EXECUTION SUMMARY");
		console.log("=".repeat(70));

		console.log(`✅ Total proposals processed: ${allExtractionResults.length}`);
		console.log(`✅ Successful: ${successCount}`);

		if (failedItems.length > 0)
		{
			console.log(`❌ Failed: ${failedItems.length}`);
			failedItems.forEach((r) =>
			{
				console.log(`   - ${r.url}: ${r.error}`);
			});
		}

		console.log(`${"=".repeat(70)}\n`);
		console.log("🎉 Script completed successfully!");

	} catch (error)
	{
		console.error("\n💥 Fatal error:", error);
	} finally
	{
		await browser.close();
		process.exit(0);
	}
})();

