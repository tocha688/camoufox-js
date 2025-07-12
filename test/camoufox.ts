import path from "path"
import { Camoufox } from "../src/index.ts"

const mmdbPath = path.join(process.cwd(), "/src/data-files/GeoLite2-City.mmdb")

console.log(mmdbPath)

async function main() {
    const brw = await Camoufox({
        headless: false,
        proxy: {
            server: "http://127.0.0.1:10808"
        },
        // executablePath: "C:\\Tools\\browser\\camoufox\\camoufox.exe",
        geoip:true,
        geoip_file:mmdbPath,
    })
    const page = await brw.newPage()
    await page.goto("https://www.browserscan.net/")
    console.log("运行完成")
}

main()