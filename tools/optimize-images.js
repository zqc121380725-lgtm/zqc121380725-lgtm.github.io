const fs = require('fs/promises');
const path = require('path');
const sharp = require('sharp');

const projectRoot = path.resolve(__dirname, '..');
const sourceDirectory = path.join(projectRoot, 'public', 'photos');
const publicOutputDirectory = path.join(projectRoot, 'public', 'photos-optimized');
const pagesOutputDirectory = path.join(projectRoot, 'photos-optimized');

async function optimizeImages() {
    const files = (await fs.readdir(sourceDirectory))
        .filter((file) => /\.(jpe?g|png)$/i.test(file))
        .sort();

    await fs.mkdir(publicOutputDirectory, { recursive: true });
    await fs.mkdir(pagesOutputDirectory, { recursive: true });

    let sourceBytes = 0;
    let outputBytes = 0;

    for (const file of files) {
        const sourcePath = path.join(sourceDirectory, file);
        const outputName = file.replace(/\.[^.]+$/, '.webp');
        const publicOutputPath = path.join(publicOutputDirectory, outputName);
        const pagesOutputPath = path.join(pagesOutputDirectory, outputName);
        const sourceStat = await fs.stat(sourcePath);

        await sharp(sourcePath)
            .rotate()
            .resize({
                width: 1800,
                height: 1800,
                fit: 'inside',
                withoutEnlargement: true
            })
            .webp({ quality: 82, effort: 5, smartSubsample: true })
            .toFile(publicOutputPath);

        await fs.copyFile(publicOutputPath, pagesOutputPath);
        const outputStat = await fs.stat(publicOutputPath);
        sourceBytes += sourceStat.size;
        outputBytes += outputStat.size;
        console.log(`${file} -> ${outputName} (${(outputStat.size / 1024 / 1024).toFixed(2)} MB)`);
    }

    const reduction = sourceBytes ? 100 - (outputBytes / sourceBytes * 100) : 0;
    console.log(`Optimized ${files.length} images: ${(sourceBytes / 1024 / 1024).toFixed(1)} MB -> ${(outputBytes / 1024 / 1024).toFixed(1)} MB (${reduction.toFixed(1)}% smaller)`);
}

optimizeImages().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});