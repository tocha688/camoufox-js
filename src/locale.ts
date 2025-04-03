import { GitHubDownloader, webdl, PACKAGE_DATA } from './pkgman.js';
import { LeakWarning } from './warnings.js';
import {
    InvalidLocale,
    MissingRelease,
    NotInstalledGeoIPExtra,
    UnknownIPLocation,
    UnknownLanguage,
    UnknownTerritory,
} from './exceptions.js';
import { validateIP } from './ip.js';
import tags from 'language-tags';
import * as fs from 'fs';
import * as path from 'path';
import maxmind, { CityResponse } from 'maxmind';
import xml2js from 'xml2js';
import { getAsBooleanFromENV } from './utils.js';

export const ALLOW_GEOIP = true;

class Locale {
    constructor(
        public language: string,
        public region?: string,
        public script?: string
    ) { }

    asString(): string {
        if (this.region) {
            return `${this.language}-${this.region}`;
        }
        return this.language;
    }

    asConfig(): Record<string, string> {
        if (!this.region) {
            throw new Error("Region is required for config");
        }
        const data: Record<string, string> = {
            'locale:region': this.region,
            'locale:language': this.language,
        };
        if (this.script) {
            data['locale:script'] = this.script;
        }
        return data;
    }
}

class Geolocation {
    constructor(
        public locale: Locale,
        public longitude: number,
        public latitude: number,
        public timezone: string,
        public accuracy?: number
    ) { }

    public asConfig(): Record<string, any> {
        const data: Record<string, any> = {
            'geolocation:longitude': this.longitude,
            'geolocation:latitude': this.latitude,
            'timezone': this.timezone,
            ...this.locale.asConfig(),
        };
        if (this.accuracy !== undefined) {
            data['geolocation:accuracy'] = this.accuracy;
        }
        return data;
    }
}

function verifyLocale(loc: string): void {
    if (tags.check(loc)) {
        return;
    }
    throw InvalidLocale.invalidInput(loc);
}

export function normalizeLocale(locale: string): Locale {
    verifyLocale(locale);

    const parser = tags(locale);
    if (!parser.region) {
        throw InvalidLocale.invalidInput(locale);
    }

    const record = parser.language()?.data['record'];

    return new Locale(
        record['Subtag'],
        parser.region()?.data['record']['Subtag'],
        record['Suppress-Script']
    );
}

export function handleLocale(locale: string, ignoreRegion: boolean = false): Locale {
    if (locale.length > 3) {
        return normalizeLocale(locale);
    }

    try {
        return SELECTOR.fromRegion(locale);
    } catch (e) {
        if (e instanceof UnknownTerritory) {
        } else {
            throw e;
        }
    }

    if (ignoreRegion) {
        verifyLocale(locale);
        return new Locale(locale);
    }

    try {
        const language = SELECTOR.fromLanguage(locale);
        LeakWarning.warn('no_region');
        return language;
    } catch (e) {
        if (e instanceof UnknownLanguage) {
        } else {
            throw e;
        }
    }

    throw InvalidLocale.invalidInput(locale);
}

export function handleLocales(locales: string | string[], config: Record<string, any>): void {
    if (typeof locales === 'string') {
        locales = locales.split(',').map(loc => loc.trim());
    }

    const intlLocale = handleLocale(locales[0]);
    config = { ...config, ...intlLocale.asConfig() };

    if (locales.length < 2) {
        return;
    }

    config['locale:all'] = joinUnique(locales.map(locale => handleLocale(locale, true).asString()));
}

function joinUnique(seq: string[]): string {
    const seen = new Set<string>();
    return seq.filter(x => !seen.has(x) && seen.add(x)).join(', ');
}

const MMDB_FILE = path.join(PACKAGE_DATA.toString(), 'GeoLite2-City.mmdb');
const MMDB_REPO = "P3TERX/GeoLite.mmdb";

class MaxMindDownloader extends GitHubDownloader {
    checkAsset(asset: Record<string, any>): string | null {
        if (asset['name'].endsWith('-City.mmdb')) {
            return asset['browser_download_url'];
        }
        return null;
    }

    missingAssetError(): void {
        throw new MissingRelease('Failed to find GeoIP database release asset');
    }
}

export function geoipAllowed(): void {
    if (!ALLOW_GEOIP) {
        throw new NotInstalledGeoIPExtra(
            'Please install the geoip extra to use this feature: pip install camoufox[geoip]'
        );
    }
}

export async function downloadMMDB(mmdb_file = MMDB_FILE): Promise<void> {
    geoipAllowed();

    if (getAsBooleanFromENV('PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD', false)) {
        console.log("Skipping GeoIP database download due to PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD set!");
        return;
    }

    const assetUrl = await (new MaxMindDownloader(MMDB_REPO).getAsset());
    const dir = path.dirname(mmdb_file);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    const fileStream = fs.createWriteStream(mmdb_file);
    await webdl(assetUrl, 'Downloading GeoIP database', true, fileStream);
}

export function removeMMDB(mmdb_file = MMDB_FILE): void {
    if (!fs.existsSync(mmdb_file)) {
        console.log("GeoIP database not found.");
        return;
    }

    fs.unlinkSync(mmdb_file);
    console.log("GeoIP database removed.");
}

export async function getGeolocation(ip: string, mmdb_file = MMDB_FILE): Promise<Geolocation> {
    if (!fs.existsSync(mmdb_file)) {
        await downloadMMDB(mmdb_file);
    }

    validateIP(ip);

    const reader = await maxmind.open<CityResponse>(mmdb_file);

    const resp = reader.get(ip)!;
    const isoCode = resp.country?.iso_code.toUpperCase();
    const location = resp.location;

    if (!location?.longitude || !location?.latitude || !location?.time_zone || !isoCode) {
        throw new UnknownIPLocation(`Unknown IP location: ${ip}`);
    }

    const locale = SELECTOR.fromRegion(isoCode);

    return new Geolocation(
        locale,
        location.longitude,
        location.latitude,
        location.time_zone
    );
}

async function getUnicodeInfo(): Promise<any> {
    const data = await fs.promises.readFile(path.join(import.meta?.dirname ?? __dirname, 'data-files', 'territoryInfo.xml'));
    const parser = new xml2js.Parser();
    return parser.parseStringPromise(data);
}

function asFloat(element: any, attr: string): number {
    return parseFloat(element[attr] || '0');
}

class StatisticalLocaleSelector {
    private root: any;

    constructor() {
        this.loadUnicodeInfo();
    }

    private async loadUnicodeInfo() {
        this.root = await getUnicodeInfo();
    }

    private loadTerritoryData(isoCode: string): [string[], number[]] {
        const territory = this.root.territoryInfo.territory.find((t: any) => t.$.type === isoCode);
        if (!territory) {
            throw new UnknownTerritory(`Unknown territory: ${isoCode}`);
        }

        const langPopulations = territory.languagePopulation;
        if (!langPopulations) {
            throw new Error(`No language data found for region: ${isoCode}`);
        }

        const languages = langPopulations.map((lang: any) => lang.$.type);
        const percentages = langPopulations.map((lang: any) => asFloat(lang.$, 'populationPercent'));

        return this.normalizeProbabilities(languages, percentages);
    }

    private loadLanguageData(language: string): [string[], number[]] {
        const territories = this.root.territory.filter((t: any) =>
            t.languagePopulation.some((lp: any) => lp.$.type === language)
        );

        if (!territories.length) {
            throw new UnknownLanguage(`No region data found for language: ${language}`);
        }

        const regions: string[] = [];
        const percentages: number[] = [];

        for (const terr of territories) {
            const region = terr.$.type;
            const langPop = terr.languagePopulation.find((lp: any) => lp.$.type === language);

            if (region && langPop) {
                regions.push(region);
                percentages.push(
                    asFloat(langPop.$, 'populationPercent') *
                    asFloat(terr.$, 'literacyPercent') / 10000 *
                    asFloat(terr.$, 'population')
                );
            }
        }

        if (!regions.length) {
            throw new Error(`No valid region data found for language: ${language}`);
        }

        return this.normalizeProbabilities(regions, percentages);
    }

    private normalizeProbabilities(languages: string[], freq: number[]): [string[], number[]] {
        const total = freq.reduce((a, b) => a + b, 0);
        return [languages, freq.map(f => f / total)];
    }

    private weightedRandomChoice<T>(items: T[], weights: number[]): T {
        const cumulativeWeights = weights.map((sum => (value: number) => sum += value)(0));
        const random = Math.random() * cumulativeWeights[cumulativeWeights.length - 1];
        return items[cumulativeWeights.findIndex(weight => weight > random)];
    }

    fromRegion(region: string): Locale {
        const [languages, probabilities] = this.loadTerritoryData(region);
        const language = this.weightedRandomChoice(languages, probabilities).replace('_', '-');
        return normalizeLocale(`${language}-${region}`);
    }

    fromLanguage(language: string): Locale {
        const [regions, probabilities] = this.loadLanguageData(language);
        const region = this.weightedRandomChoice(regions, probabilities);
        return normalizeLocale(`${language}-${region}`);
    }
}

const SELECTOR = new StatisticalLocaleSelector();
