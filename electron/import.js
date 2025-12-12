import mammoth from 'mammoth'
import * as XLSX from 'xlsx'
import WordExtractor from 'word-extractor'
import fs from 'fs'
import path from 'path'
import { dialog } from 'electron'
import TurndownService from 'turndown'
import { gfm } from 'turndown-plugin-gfm'

const turndownService = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced'
})
turndownService.use(gfm)

// Custom rule to keep tables as HTML if they have merged cells or complex styles
turndownService.addRule('complexTable', {
    filter: (node) => {
        if (node.nodeName !== 'TABLE') return false
        // Check for merged cells
        const html = node.outerHTML
        return html.includes('colspan') || html.includes('rowspan')
    },
    replacement: (content, node) => {
        return '\n\n' + node.outerHTML + '\n\n'
    }
})

export async function selectAndParseFiles() {
    const { filePaths } = await dialog.showOpenDialog({
        properties: ['openFile', 'multiSelections'],
        filters: [
            { name: '所有支持格式', extensions: ['docx', 'doc', 'xlsx', 'xls', 'md', 'txt'] },
            { name: 'Word 文档', extensions: ['docx', 'doc'] },
            { name: 'Excel 表格', extensions: ['xlsx', 'xls'] },
            { name: 'Markdown', extensions: ['md'] },
            { name: '纯文本', extensions: ['txt'] }
        ]
    })

    if (!filePaths || filePaths.length === 0) return []
    if (filePaths.length > 100) {
        throw new Error('批量导入不能超过100个文件')
    }

    const results = []
    
    for (const filePath of filePaths) {
        // Check size (50MB limit)
        const stats = fs.statSync(filePath)
        if (stats.size > 50 * 1024 * 1024) {
             results.push({
                title: path.basename(filePath),
                content: `[导入失败: 文件超过50MB]`,
                originalPath: filePath,
                error: true
            })
            continue
        }

        try {
            const ext = path.extname(filePath).toLowerCase()
            const filename = path.basename(filePath)
            let content = ''
            
            if (ext === '.docx') {
                const result = await mammoth.convertToHtml({ path: filePath })
                // Mammoth output clean HTML.
                // Our Turndown rule will preserve tables with colspan/rowspan as HTML,
                // and convert simple tables to Markdown.
                content = turndownService.turndown(result.value)
            } else if (ext === '.doc') {
                const extractor = new WordExtractor()
                const extracted = await extractor.extract(filePath)
                content = extracted.getBody()
            } else if (ext === '.xlsx' || ext === '.xls') {
                const workbook = XLSX.readFile(filePath)
                const sheetName = workbook.SheetNames[0]
                const sheet = workbook.Sheets[sheetName]
                const html = XLSX.utils.sheet_to_html(sheet)
                content = turndownService.turndown(html)
            } else {
                // md, txt
                content = fs.readFileSync(filePath, 'utf-8')
            }
            
            results.push({
                title: filename,
                content: content,
                originalPath: filePath,
                success: true
            })
        } catch (e) {
            console.error(`Failed to parse ${filePath}`, e)
            results.push({
                title: path.basename(filePath),
                content: `[导入失败: ${e.message}]`,
                originalPath: filePath,
                error: true,
                message: e.message
            })
        }
    }
    return results
}
