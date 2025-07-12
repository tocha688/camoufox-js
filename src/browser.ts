import fs from 'fs';
import { launchPath } from './pkgman.js';
import { LaunchOptions } from './utils.js';

export async function checkBrowser(launch_options: LaunchOptions) {
    if (launch_options.executable_path) {
        return;
    }
    //检查默认目录
    const exePath = launchPath();
    launch_options.executable_path = exePath;
}

