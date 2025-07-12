import path from "path"
import { Camoufox } from "../dist/index.js"



async function main() {
    const brw = await Camoufox({
        headless: false,
        proxy: {
            server: "http://127.0.0.1:10808"
        },
        // executablePath: "C:\\Tools\\browser\\camoufox\\camoufox.exe",
        geoip: true,
    })
    const page = await brw.newPage()
    await page.goto("https://www.browserscan.net/")
    console.log("运行完成")
}

main()