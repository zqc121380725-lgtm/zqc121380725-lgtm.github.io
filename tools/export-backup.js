const fs = require('fs');
const path = require('path');
const { createStorage } = require('../storage');

function argument(name) {
    const index = process.argv.indexOf(name);
    return index >= 0 ? process.argv[index + 1] : '';
}

function atomicWrite(filePath, payload) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const temporaryFile = `${filePath}.${process.pid}.tmp`;
    fs.writeFileSync(temporaryFile, JSON.stringify(payload, null, 2), 'utf8');
    fs.renameSync(temporaryFile, filePath);
}

async function main() {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const output = path.resolve(
        argument('--output') || path.join('backups', `wedding-backup-${stamp}.json`)
    );
    const storage = await createStorage({
        databaseUrl: String(process.env.DATABASE_URL || '').trim(),
        dataFile: path.resolve(process.env.DATA_FILE || 'data.json')
    });
    try {
        const bundle = await storage.exportBundle();
        if (!bundle.state) throw new Error('存储中没有可导出的当前状态');
        atomicWrite(output, bundle);
        console.log(`备份导出成功: ${output}`);
        console.log(`状态版本: ${bundle.version}; 事件: ${bundle.events.length}; 快照: ${bundle.snapshots.length}`);
    } finally {
        await storage.close();
    }
}

main().catch(error => {
    console.error(`备份导出失败: ${error.message}`);
    process.exitCode = 1;
});
