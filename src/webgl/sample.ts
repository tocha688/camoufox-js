import { LOCAL_DATA, OS_ARCH_MATRIX } from '../pkgman.js';
import path from 'node:path';
import fs from 'node:fs';
import initSqlJs from 'sql.js';

// 获取相对于此文件的数据库路径
const DB_PATH = path.join(LOCAL_DATA.toString(), 'webgl_data.db');

interface WebGLData {
    vendor: string;
    renderer: string;
    data: any;
}

export async function sampleWebGL(os: string, vendor?: string, renderer?: string): Promise<WebGLData> {
    if (!OS_ARCH_MATRIX[os]) {
        throw new Error(`Invalid OS: ${os}. Must be one of: ${Object.keys(OS_ARCH_MATRIX).join(', ')}`);
    }

    // 初始化 SQL.js
    const SQL = await initSqlJs();
    
    // 读取数据库文件
    const dbBuffer = fs.readFileSync(DB_PATH);
    
    // 使用文件内容创建数据库对象
    const db = new SQL.Database(new Uint8Array(dbBuffer));
    
    try {
        let query = '';
        let params: any[] = [];

        if (vendor && renderer) {
            query = `SELECT vendor, renderer, data, ${os} FROM webgl_fingerprints WHERE vendor = ? AND renderer = ?`;
            params = [vendor, renderer];
        } else {
            query = `SELECT vendor, renderer, data, ${os} FROM webgl_fingerprints WHERE ${os} > 0`;
        }

        // 执行查询
        const stmt = db.prepare(query);
        const rows: any[] = [];
        
        // 绑定参数并执行
        stmt.bind(params);
        
        // 获取所有结果
        while(stmt.step()) {
            rows.push(stmt.getAsObject());
        }
        stmt.free();

        if (rows.length === 0) {
            throw new Error(`No WebGL data found for OS: ${os}`);
        }

        if (vendor && renderer) {
            const result = rows[0];
            if (result[os] <= 0) {
                // 获取可用的供应商和渲染器组合
                const pairsStmt = db.prepare(`SELECT DISTINCT vendor, renderer FROM webgl_fingerprints WHERE ${os} > 0`);
                const pairs: any[] = [];
                
                while(pairsStmt.step()) {
                    pairs.push(pairsStmt.getAsObject());
                }
                pairsStmt.free();
                
                throw new Error(`Vendor "${vendor}" and renderer "${renderer}" combination not valid for ${os}. Possible pairs: ${pairs.map(pair => `${pair.vendor}, ${pair.renderer}`).join(', ')}`);
            }
            return JSON.parse(result.data);
        } else {
            const dataStrs = rows.map(row => row.data);
            const probs = rows.map(row => row[os]);
            const probsArray = probs.map(p => p / probs.reduce((a, b) => a + b, 0));
            
            function weightedRandomChoice(weights: number[]): number {
                const sum = weights.reduce((acc, weight) => acc + weight, 0);
                const threshold = Math.random() * sum;
                let cumulativeSum = 0;

                for (let i = 0; i < weights.length; i++) {
                    cumulativeSum += weights[i];
                    if (cumulativeSum >= threshold) {
                        return i;
                    }
                }

                return weights.length - 1; // 防止舍入误差的回退
            }

            const idx = weightedRandomChoice(probsArray);
            return JSON.parse(dataStrs[idx]);
        }
    } finally {
        // 关闭数据库连接
        db.close();
    }
}

interface PossiblePairs {
    [key: string]: Array<{ vendor: string, renderer: string }>;
}

export async function getPossiblePairs(): Promise<PossiblePairs> {
    // 初始化 SQL.js
    const SQL = await initSqlJs();
    
    // 读取数据库文件
    const dbBuffer = fs.readFileSync(DB_PATH);
    
    // 使用文件内容创建数据库对象
    const db = new SQL.Database(new Uint8Array(dbBuffer));
    
    try {
        const result: PossiblePairs = {};
        const osTypes = Object.keys(OS_ARCH_MATRIX);

        for (const osType of osTypes) {
            const stmt = db.prepare(
                `SELECT DISTINCT vendor, renderer FROM webgl_fingerprints WHERE ${osType} > 0 ORDER BY ${osType} DESC`
            );
            
            const rows: Array<{ vendor: string, renderer: string }> = [];
            while(stmt.step()) {
                const row = stmt.getAsObject();
                rows.push({
                    vendor: row.vendor as string,
                    renderer: row.renderer as string
                });
            }
            stmt.free();
            
            result[osType] = rows;
        }

        return result;
    } finally {
        db.close();
    }
}
