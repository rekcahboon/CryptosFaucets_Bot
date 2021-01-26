require('dotenv').config()

const fs = require('fs').promises;
const select = require ('puppeteer-select')
const puppeteer = require('puppeteer')

const ONE_HOUR_MS = 3600000
const LAST_CALL_FS = 'lastCall'
const WEBSITES_FS = 'config/websites.txt'

/**
 * Scroll the page. We need to scroll in order to allow to click on element.
 * Element is accessible only if it is visible and it can be visible with scroll.
 *
 * @param page
 * @return {Promise<void>}
 */
const autoScroll = async (page) => {
	await page.evaluate(async () => {
		await new Promise((resolve) => {
			let totalHeight = 0
			const distance = 50
			const timer = setInterval(() => {
				const scrollHeight = document.body.scrollHeight
				window.scrollBy(0, distance)
				totalHeight += distance
				
				if (totalHeight >= scrollHeight) {
					clearInterval(timer)
					resolve()
				}
			}, 100)
		})
	})
}

const sleep = (ms) => {
	return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Save timestamp to know the last time we opened faucet with success
 */
const saveTimestamp = async (date) => {
	try {
		await fs.writeFile(LAST_CALL_FS, date)
	} catch (e) {
		console.error('Writing Timestamp error', e)
	}
}

/**
 * Get last timestamp where we opened successfully faucet
 */
const getTimestamp = async () => {
	try {
		return await fs.readFile(LAST_CALL_FS, 'utf8')
	} catch (e) {
		//console.error('Reading Timestamp error', e)
		return 0
	}
}

/**
 * Search the timestamp when we must open faucet
 */
const getWakeUpTs = async() => {
	try {
		const data = await fs.readFile(LAST_CALL_FS, 'utf8')
		const now = Date.now()
		return (now - data > ONE_HOUR_MS) ? ONE_HOUR_MS : ONE_HOUR_MS - (now - data)
	} catch (e) {
		//console.error('Timestamp error', e)
		return ONE_HOUR_MS
	}
}

const dateToPrint = () => {
	const now = new Date();
	return '[' + now.getHours() + 'h' + ( (now.getMinutes() < 10 ? '0' : '') + now.getMinutes() ) + '] '
}

/**
 * Add random offset between #start and #end. The aim of this function is to
 * add some random between actions to avoid suspicion
 *
 * @return {number} between 1 second and 5 minutes
 */
const randomOffset = () => {
	const start = 1000  // 1 second
	const end =  60000  // 1 minute
	return Math.floor(Math.random() * (end - start + 1) + start)
}

const duringToPrint = (timeInMs, offsetInMs = 0) => {
	const timeDate = new Date(timeInMs + offsetInMs)
	let offsetMsg = ''
	if (offsetInMs > 0) {
		const offsetDate = new Date(offsetInMs)
		offsetMsg = '[including offset=' + (offsetDate.getMinutes() > 0 ? offsetDate.getMinutes() + 'm ' : '') +
		offsetDate.getSeconds() + 's]'
	}
	return (timeDate.getMinutes() > 0 ? timeDate.getMinutes() + ' min ' : '') + timeDate.getSeconds() + ' seconds ' + offsetMsg
}

/**
 * MAIN
 */
(async () => {
	const email = process.env.EMAIL
	const pass = process.env.PASS
	
	console.log('--- STARTING BOT ---\n')
	console.log('Email:', email)
	
	const websitesFs = await fs.readFile(WEBSITES_FS, 'utf8')
	const websites = websitesFs.replace(/\n/g, '').split(',').map(x => x + '/set-language/en')
	
	while (true) {
		
		const lastCallTs = await getTimestamp()
		
		if ((Date.now() - lastCallTs) > ONE_HOUR_MS) {
			
			let loopError = false
			const browser = await puppeteer.launch({ headless: true, args: ['--lang=en']})
			const page = await browser.newPage()
			await page.setViewport({ width: 1866, height: 768})
			
			console.log('TIMESTAMP: ' + dateToPrint() + '\n\n--- ATTEMPTING ROLL ---\n')
			
			for (let i = 0; i < websites.length; i++) {
				
				try {
					
					await page.goto(websites[i], { waitUntil: 'networkidle2', timeout: 0 })
					await sleep(200)
					
					console.log(websites[i])
					
					await page.type('input[name=email]', email, {delay: 20})
					await page.type('input[name=password]', pass, {delay: 20})
					const element = await select(page).getElement('button:contains(LOGIN!)')
					await element.click()
					
					//To avoid timeout -> use networkidle2
					await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 0 });
					
					await autoScroll(page);
					const element_roll = await select(page).getElement('button:contains(ROLL!)')
					await element_roll.click()
					await sleep(2000);
					
					//Get inner HTML
					const innerText = await page.evaluate(() => document.querySelector('.navbar-coins').innerText)
					
					console.log('Balance:', innerText);
					console.log("SUCCESS! COIN CLAIMED!\n")
					
				} catch(e) {
					console.log('ERROR WAS ENCOUNTERED ON: ', websites[i])
					console.error("ERROR: " + e.message)
					console.log("FAILED! COIN NOT CLAIMED!\n")
					loopError = true
				}
			}
			
			await page.close()
			await browser.close()
			if (loopError) {
				
				console.log('### THERE WAS AN ERROR, RETRYING IN 1 MIN ###\n')
				
				await sleep(60000)
			} else {
				
				console.log('ALL COINS HAVE BEEN COLLECTED SUCCESSFULLY!')
				console.log(dateToPrint() + "PAUSING PROCESS\n RELAUNCHING IN 1 HOUR")
				
				await saveTimestamp(Date.now().toString())
				await sleep(ONE_HOUR_MS + randomOffset())
				
				console.log('--- LAUNCHING ---')
			}
		} else {
			const offset = randomOffset()
			let delay = await getWakeUpTs()
			
			console.log(dateToPrint() + "PAUSED\n LAUNCHING IN: " + duringToPrint(delay, offset))
			
			delay += offset
			await sleep(delay)
		}
	}
})()