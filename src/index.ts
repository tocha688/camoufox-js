import { PathLike } from 'fs';
import { camoufoxPath, INSTALL_DIR } from './pkgman.js';

export { Camoufox, NewBrowser } from './sync_api.js';
export { launchOptions } from './utils.js';
export { downloadMMDB, removeMMDB } from './locale.js';
export { getLaunchPath, INSTALL_DIR } from './pkgman.js';

export async function downloadBrowser(installDir:PathLike=INSTALL_DIR){
    return await camoufoxPath(installDir)
}
