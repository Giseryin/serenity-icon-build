// make sure vue template compiler do not throw error
require('vue').version = null

const fse = require('fs-extra')
const execa = require('execa')
const v2s = require('v2s')
const { camelCase, upperFirst } = require('lodash')
const path = require('path')
const sharp = require('sharp')
const HOME_DIR = path.resolve(__dirname, '..')

const projectDir = HOME_DIR

const ICONS_DIR = path.resolve(HOME_DIR, 'src/svg')

function readSvg(fileName, directory) {
  return fse.readFileSync(path.join(directory, fileName), 'utf-8')
}

function readSvgDirectory(directory) {
  return fse.readdirSync(directory).filter((file) => path.extname(file) === '.svg')
}

function removeComment (src) {
  return src.replace(/<!--(.*?)-->/g, '')
}

function removeUselessTags(src) {
  return src
    .replace(
      /<\?xml(.*?)\?>/g,
      ''
    )
    .replace(
      /<!DOCTYPE(.*?)>/g,
      ''
    )  
    .replace( // 去除制表符
      /\t|\n|\r/g,
      ''
    )    
    .replace(
      /<title>(.*?)<\/title>/g,
      ''
    )
    .replace(
      /<desc>(.*?)<\/desc>/g,
      ''
    )
}

function removeSvgAttr (src, ...attrs) {
  const svgRegex = /<svg[^>]*>/
  let svgContent = src.match(svgRegex)[0]
  attrs.forEach(attr => {
    svgContent = svgContent.replace(ensureAttrRegex(attr), '')
  })
  return src.replace(
    svgRegex,
    svgContent
  )
}

const attrRegex = {}

function ensureAttrRegex (attr) {
  return attrRegex[attr] || (attrRegex[attr] = new RegExp(`\\s${attr}="([^"]*)"`, 'g'))
}

function removeAttr (src, ...attrs) {
  return attrs.reduce(
    (code, attr) => code.replace(ensureAttrRegex(attr), ''),
    src
  )
}

function refill (src) {
  return src
    .replace(
      /fill="([^"n]+)"/g,
      'fill="currentColor"'
    )
    .replace(
      /stroke="([^"n]+)"/g,
      'stroke="currentColor"'
    )
    .replace(
      /fill: ([^;n]+);/g,
      'fill: currentColor;'
    )
    .replace(
      /stroke: *([^;n]+);/g,
      'stroke: currentColor;'
    )
}

function createSvgSanitizer(src) {
  this.removeAttr = (...attrs) => {
    src = removeAttr(src, ...attrs)
    return this
  }
  this.removeSvgAttr = (...attrs) => {
    src = removeSvgAttr(src, ...attrs)
    return this
  }
  this.removeComment = () => {
    src = removeComment(src)
    return this
  }
  this.removeUselessTags = () => {
    src = removeUselessTags(src)
    return this
  }
  this.refill = () => {
    src = refill(src)
    return this
  }
  this.svg = () => src
  return this
}

function normalizeName(name) {
  return upperFirst(camelCase(name))
}

function readSvgs() {
  const svgFiles = readSvgDirectory(ICONS_DIR)
  return svgFiles.map(svgFile => {
    const name = path.basename(svgFile, '.svg')
    const normalizedName = normalizeName(name)
    const contents = readSvg(svgFile, ICONS_DIR).trim()
    const svgSanitizer = createSvgSanitizer(contents)
    svgSanitizer
      .removeComment()
      .removeUselessTags()
      .removeAttr('id')
      .removeSvgAttr('width', 'height')
      .refill()
    
    const svg = svgSanitizer.svg()
    return {
      name: normalizedName,
      svg
    }
  })
}


const icons = readSvgs()

icons.sort((v1, v2) => {
  if (v1.name < v2.name) return -1
  if (v1.name > v2.name) return 1
  return 0
})

const outPath = path.resolve(__dirname, '..', 'components/dist')

async function generateIndex(names, indexExt, componentExt, outPath) {
  const exportStmts =
    names
      .map((n) => `export { default as ${n} } from './${n}${componentExt}'`)
      .join('\n') + '\n'
  await fse.writeFile(path.resolve(outPath, `index${indexExt}`), exportStmts)
}

async function generateAsyncIndex(names, indexExt, componentExt, outPath) {
  const asyncExportStmts =
    names
      .map((n) => `export const ${n} = () => import('./${n}${componentExt}')`)
      .join('\n') + '\n'
  await fse.writeFile(
    path.resolve(outPath, `async-index${indexExt}`),
    asyncExportStmts
  )
}

async function tsc(config, outPath) {
  const tsConfigPath = path.resolve(outPath, 'tsconfig.json')
  await fse.writeFile(tsConfigPath, JSON.stringify(config, 0, 2))
  const { stdout, stderr } = await execa('npx', ['tsc', '-p', tsConfigPath], {
    cwd: projectDir
  })
  console.log(stdout)
  if (stderr) {
    console.error(stderr)
  }
  await fse.unlink(tsConfigPath)
}

async function generateVue3(icons, basePath) {
  const distDir = path.resolve(__dirname, '..', 'components')
  if (!(await fse.stat(distDir).catch(() => false))) {
    await fse.mkdir(distDir)
  }
  if (!(await fse.stat(basePath).catch(() => false))) {
    await fse.mkdir(basePath)
  }
  const names = icons.map((v) => v.name)
  const tempPath = path.resolve(basePath, '_vue3')
  if (!(await fse.stat(tempPath).catch(() => false))) {
    await fse.mkdir(tempPath)
  }

  for (const { name, svg } of icons) {
    await fse.writeFile(
      path.resolve(tempPath, `${name}.vue`),
      '<template>\n' +
        svg +
        '\n' +
      '</template>\n' +
      '<script lang="ts">\n' +
      `import { defineComponent } from 'vue'\n` +
      'export default defineComponent({\n' +
      `  name: '${name}'\n` +
      '})\n' +
      '</script>'
    )
  }
  await generateIndex(names, '.ts', '.vue', tempPath)
  await generateAsyncIndex(names, '.ts', '.vue', tempPath)
  const dir = await fse.readdir(tempPath)
  const paths = dir.map((fileName) => path.resolve(tempPath, fileName))
  await v2s(paths, {
    deleteSource: true,
    refactorVueImport: true
  })
  const compilerOptionsBase = {
    forceConsistentCasingInFileNames: true,
    moduleResolution: 'node',
    target: 'ES6',
    lib: ['ESNext', 'DOM'],
    types: [], // ignore @types/react, which causes error
    declaration: true
  }
  console.log('  tsc to vue3 (cjs)')
  await tsc(
    {
      include: ['_vue3/**/*'],
      compilerOptions: {
        ...compilerOptionsBase,
        outDir: 'vue3/lib',
        module: 'CommonJS'
      }
    },
    basePath
  )
  console.log('  copy cjs output to root')
  const cjsDir = await fse.readdir(path.resolve(basePath, 'vue3/lib'))
  for (const file of cjsDir) {
    await fse.copy(
      path.resolve(basePath, 'vue3/lib', file),
      path.resolve(basePath, 'vue3', file)
    )
  }
  console.log('  tsc to vue3 (esm)')
  await tsc(
    {
      include: ['_vue3/**/*'],
      compilerOptions: {
        ...compilerOptionsBase,
        outDir: 'vue3/es',
        module: 'ESNext'
      }
    },
    basePath
  )
  // remove _vue3
  console.log('  remove _vue3')
  await fse.remove(tempPath)

  // copy vue3/lib to lib
  console.log('vue3/lib to lib')
  const libDir = await fse.readdir(path.resolve(basePath, 'vue3/lib'))
  for (const file of libDir) {
    await fse.copy(
      path.resolve(basePath, 'vue3/lib', file),
      path.resolve(projectDir, 'components/lib', file)
    )
  }
  // copy vue3/es to es
  console.log('copy vue3/es to es')
  const esDir = await fse.readdir(path.resolve(basePath, 'vue3/es'))
  for (const file of esDir) {
    await fse.copy(
      path.resolve(basePath, 'vue3/es', file),
      path.resolve(projectDir, 'components/es', file)
    )
  }
  // copy vue3/lib to dist
  console.log('copy vue3/lib to dist')
  for (const file of libDir) {
    await fse.copy(
      path.resolve(basePath, 'vue3/lib', file),
      path.resolve(basePath, file)
    )
  }
  await fse.remove(path.resolve(basePath, 'vue3'))
}

async function clearPngOutputs(pngDir) {
  fse.removeSync(pngDir)
  fse.ensureDirSync(pngDir)
}
async function buildPNG(io) {
  const svgFiles = fse.readdirSync(io.entry).filter((svgFile) => svgFile.endsWith('.svg'))
  const pngDir = path.resolve(io.output, 'png')

  clearPngOutputs(pngDir)

  await Promise.all(
    svgFiles.map(
      (svg) =>
        new Promise((done) => {
          const { name } = path.parse(svg)
          sharp(path.resolve(io.entry, svg))
            .resize({ height: 128 })
            .toBuffer()
            .then((buffer) => {
              sharp({
                create: {
                  width: 128,
                  height: 128,
                  channels: 4,
                  background: '#4a7afe',
                },
              })
                .composite([
                  {
                    input: buffer,
                    blend: 'dest-in',
                  },
                ])
                .png()
                .toFile(path.resolve(pngDir, `${name}.png`))
                .then(() => {
                  done()
                })
            })
        })
    )
  )
  console.log('build png success!')
}
buildPNG({
  entry: ICONS_DIR,
  output: HOME_DIR
})
generateVue3(icons, outPath)
