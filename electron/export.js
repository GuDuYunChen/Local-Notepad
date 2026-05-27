import { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, BorderStyle, WidthType, ImageRun } from 'docx'
import fs from 'fs'
import path from 'path'
import { BrowserWindow } from 'electron'

// 辅助：获取文件内容（从 Go 后端）
async function fetchFileContent(id) {
    const base = process.env.API_BASE || 'http://127.0.0.1:27121'
    const res = await fetch(`${base}/api/files/${id}`)
    if (!res.ok) throw new Error(`Fetch failed: ${res.statusText}`)
    const body = await res.json()
    if (body.code !== 0) throw new Error(body.message)
    return body.data
}

// 辅助：解析 Lexical State
function parseLexicalState(content) {
    try {
        const state = JSON.parse(content)
        return state.root ? state.root.children : []
    } catch (e) {
        // Fallback: treat as plain text
        return [{ type: 'paragraph', children: [{ type: 'text', text: content }] }]
    }
}

// 转换器：Lexical Node -> Docx Object
async function convertNode(node) {
    if (!node.type) return null

    switch (node.type) {
        case 'heading':
            const level = node.tag === 'h1' ? HeadingLevel.HEADING_1 :
                          node.tag === 'h2' ? HeadingLevel.HEADING_2 :
                          node.tag === 'h3' ? HeadingLevel.HEADING_3 :
                          HeadingLevel.HEADING_4
            return new Paragraph({
                heading: level,
                children: await convertChildren(node.children)
            })
            
        case 'paragraph':
            return new Paragraph({
                children: await convertChildren(node.children)
            })
            
        case 'quote':
            return new Paragraph({
                style: 'Quote', // 需要在 Document 样式中定义，或者直接设置缩进/斜体
                indent: { left: 720 }, // 0.5 inch
                children: await convertChildren(node.children)
            })
            
        case 'list': // unordered-list or ordered-list
             // Lexical lists are nested.
             // But here 'list' usually contains 'listitem'
             // We need to handle list items individually.
             // Actually Lexical 0.10+ structure: list -> listitem
             return await convertList(node)

        case 'table':
            return await convertTable(node)
            
        case 'image':
        case 'image-grid': // Custom node?
            // Handle image logic
            // node.src might be base64 or url
            return await convertImage(node)

        default:
            // Fallback for unknown nodes
            if (node.children) {
                 return new Paragraph({ children: await convertChildren(node.children) })
            }
            return null
    }
}

async function convertChildren(children) {
    if (!children) return []
    const runs = []
    for (const child of children) {
        if (child.type === 'text') {
            runs.push(new TextRun({
                text: child.text,
                bold: (child.format & 1) !== 0,
                italics: (child.format & 2) !== 0,
                strike: (child.format & 4) !== 0,
                underline: (child.format & 8) !== 0 ? {} : undefined,
                code: (child.format & 16) !== 0,
            }))
        } else if (child.type === 'linebreak') {
             // Handled by new TextRun({ break: 1 }) or just ignored if separate paragraph?
             // Usually TextRun can contain break.
             runs.push(new TextRun({ text: '\n' })) // or break: 1
        } else if (child.type === 'link') {
             // Link handling
             const linkRuns = await convertChildren(child.children)
             // docx lib handles ExternalHyperlink
             // For simplicity, just add text runs with color blue
             linkRuns.forEach(r => {
                 // r is TextRun. We can't modify it easily if it's already created?
                 // TextRun is immutable-ish in construction?
                 // Let's just append them. Ideally we wrap in ExternalHyperlink.
                 runs.push(r)
             })
        }
    }
    return runs
}

async function convertList(node) {
    // node.listType: 'bullet' | 'number'
    // node.children: [ { type: 'listitem', children: [...] } ]
    // We return an array of Paragraphs
    const paras = []
    const isNum = node.listType === 'number'
    
    for (const item of node.children) {
        if (item.type === 'listitem') {
            const children = await convertChildren(item.children)
            paras.push(new Paragraph({
                children: children,
                bullet: {
                    level: 0 // nested lists handling needed for robust support
                }
            }))
        }
    }
    return paras // Wait, convertNode returns ONE object usually.
    // If we return array, the caller needs to handle it.
}

async function convertTable(node) {
    // node.children (rows) -> row.children (cells)
    const rows = []
    for (const rowNode of node.children) {
        const cells = []
        for (const cellNode of rowNode.children) {
            // cellNode.children (content inside cell)
            // docx TableCell expects children as Paragraphs/Tables
            // We need to convert cellNode.children recursively
            // But convertNode returns Paragraphs.
            
            const cellContent = []
            for (const n of cellNode.children) {
                const converted = await convertNode(n)
                if (converted) {
                     if (Array.isArray(converted)) cellContent.push(...converted)
                     else cellContent.push(converted)
                }
            }
            if (cellContent.length === 0) {
                cellContent.push(new Paragraph({}))
            }

            cells.push(new TableCell({
                children: cellContent,
                width: { size: 100, type: WidthType.PERCENTAGE }, // Auto width
                borders: {
                    top: { style: BorderStyle.SINGLE, size: 1 },
                    bottom: { style: BorderStyle.SINGLE, size: 1 },
                    left: { style: BorderStyle.SINGLE, size: 1 },
                    right: { style: BorderStyle.SINGLE, size: 1 },
                }
            }))
        }
        rows.push(new TableRow({ children: cells }))
    }
    
    return new Table({
        rows: rows,
        width: { size: 100, type: WidthType.PERCENTAGE }
    })
}

async function convertImage(node) {
    // node.src
    try {
        let buffer
        if (node.src.startsWith('data:')) {
            const base64 = node.src.split(',')[1]
            buffer = Buffer.from(base64, 'base64')
        } else if (node.src.startsWith('http')) {
            // Fetch
            const res = await fetch(node.src)
            const arr = await res.arrayBuffer()
            buffer = Buffer.from(arr)
        }
        
        if (buffer) {
             return new Paragraph({
                 children: [
                     new ImageRun({
                         data: buffer,
                         transformation: { width: 400, height: 300 } // Fixed size for now, better to read metadata
                     })
                 ]
             })
        }
    } catch (e) {
        console.error("Image convert error", e)
    }
    return new Paragraph({ text: "[图片加载失败]" })
}

// 核心导出函数
export async function exportToDocx(files, targetDir) {
    // files: [{ id, content, title, is_folder, ... }]
    // We might need to fetch content if not provided full
    // But `fetchFileContent` does that.
    
    // Recursive export
    // But here we receive a flat list or IDs?
    // The previous implementation passed IDs.
    // Let's assume we receive IDs and fetch recursively?
    // Or we receive the full tree structure?
    // The previous Go implementation did recursive fetching.
    
    // To simplify, let's implement a recursive function that fetches from Go.
    
    // But wait, files is IDs?
    // Let's accept IDs.
}

export async function processExport(ids, targetDir, format = 'docx') {
    const errors = []
    
    async function processItem(id, currentDir) {
        try {
            const file = await fetchFileContent(id)
            const safeTitle = file.title.replace(/[\\/:*?"<>|]/g, '_')
            
            if (file.is_folder) {
                const newDir = path.join(currentDir, safeTitle)
                if (!fs.existsSync(newDir)) fs.mkdirSync(newDir)
                
                const base = process.env.API_BASE || 'http://127.0.0.1:27121'
                const res = await fetch(`${base}/api/files?size=10000`)
                const allFiles = (await res.json()).data
                
                const children = allFiles.filter(f => f.parent_id === id)
                for (const child of children) {
                    await processItem(child.id, newDir, format)
                }
                
            } else {
                if (format === 'markdown' || format === 'md') {
                    const mdContent = convertToMarkdown(file.content)
                    fs.writeFileSync(path.join(currentDir, `${safeTitle}.md`), mdContent)
                } else {
                    const docChildren = []
                    const lexicalNodes = parseLexicalState(file.content)
                    
                    for (const node of lexicalNodes) {
                        const converted = await convertNode(node)
                        if (converted) {
                            if (Array.isArray(converted)) docChildren.push(...converted)
                            else docChildren.push(converted)
                        }
                    }
                    
                    const doc = new Document({
                        sections: [{
                            properties: {},
                            children: docChildren
                        }]
                    })
                    
                    const buffer = await Packer.toBuffer(doc)
                    fs.writeFileSync(path.join(currentDir, `${safeTitle}.docx`), buffer)
                }
            }
        } catch (e) {
            console.error(`Export ${id} failed`, e)
            errors.push(id)
        }
    }

    for (const id of ids) {
        await processItem(id, targetDir, format)
    }
    
    return errors
}

function convertToMarkdown(lexicalJSON) {
    try {
        const state = JSON.parse(lexicalJSON)
        const root = state.root || { children: [] }
        return processLexicalRoot(root)
    } catch (e) {
        return lexicalJSON
    }
}

function processLexicalRoot(root) {
    const lines = []
    for (const node of root.children || []) {
        processNodeToMarkdown(node, lines, 0)
    }
    return lines.join('\n')
}

function processNodeToMarkdown(node, lines, depth) {
    if (!node || !node.type) return
    
    switch (node.type) {
        case 'paragraph':
            const text = processInlineNodes(node.children || [])
            if (text) {
                lines.push(text)
                lines.push('')
            }
            break
            
        case 'heading':
            const level = node.level || 1
            const headingText = processInlineNodes(node.children || [])
            lines.push(`${'#'.repeat(level)} ${headingText}`)
            lines.push('')
            break
            
        case 'list':
            const listType = node.listType === 'number' ? 'number' : 'bullet'
            processListItems(node.children || [], lines, listType, 0)
            break
            
        case 'quote':
            const quoteText = processInlineNodes(node.children || [])
            lines.push(`> ${quoteText}`)
            lines.push('')
            break
            
        case 'code':
            const codeText = processInlineNodes(node.children || [])
            lines.push('```')
            lines.push(codeText)
            lines.push('```')
            lines.push('')
            break
            
        case 'code-block':
            const lang = node.language || ''
            const blockText = processInlineNodes(node.children || [])
            lines.push(`\`\`\`${lang}`)
            lines.push(blockText)
            lines.push('```')
            lines.push('')
            break
            
        case 'table':
            processTableToMarkdown(node, lines)
            break
            
        default:
            if (node.children) {
                for (const child of node.children) {
                    processNodeToMarkdown(child, lines, depth + 1)
                }
            }
    }
}

function processInlineNodes(children) {
    if (!children || children.length === 0) return ''
    
    let result = ''
    for (const child of children) {
        if (child.type === 'text') {
            let text = child.text || ''
            const format = child.format || 0
            
            if (format & 16) text = `\`${text}\``
            else {
                if (format & 8) text = `~~${text}~~`
                if (format & 2) text = `*${text}*`
                if (format & 1) text = `**${text}**`
            }
            result += text
        } else if (child.type === 'linebreak') {
            result += '\n'
        } else if (child.type === 'link') {
            const linkText = processInlineNodes(child.children || [])
            result += `[${linkText}](${child.url || ''})`
        }
    }
    return result
}

function processListItems(items, lines, listType, indent) {
    let counter = 1
    const prefix = '  '.repeat(indent)
    
    for (const item of items) {
        if (item.type === 'listitem') {
            const text = processInlineNodes(item.children || [])
            const bullet = listType === 'number' ? `${counter}.` : '-'
            lines.push(`${prefix}${bullet} ${text}`)
            counter++
            
            for (const child of item.children || []) {
                if (child.type === 'list') {
                    const nestedType = child.listType === 'number' ? 'number' : 'bullet'
                    processListItems(child.children || [], lines, nestedType, indent + 1)
                }
            }
        }
    }
}

function processTableToMarkdown(node, lines) {
    const rows = node.children || []
    if (rows.length === 0) return
    
    for (let i = 0; i < rows.length; i++) {
        const row = rows[i]
        const cells = row.children || []
        const cellTexts = cells.map(cell => processInlineNodes(cell.children || []))
        lines.push(`| ${cellTexts.join(' | ')} |`)
        
        if (i === 0) {
            lines.push(`| ${cells.map(() => '---').join(' | ')} |`)
        }
    }
    lines.push('')
}

export async function exportToPDF(file, outputPath) {
    const win = new BrowserWindow({
        show: false,
        width: 800,
        height: 600,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true
        }
    })

    try {
        const htmlContent = `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
                <style>
                    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 40px; line-height: 1.6; }
                    h1, h2, h3, h4 { margin-top: 24px; margin-bottom: 12px; }
                    p { margin-bottom: 12px; }
                    blockquote { border-left: 4px solid #ddd; padding-left: 16px; color: #666; margin: 16px 0; }
                    code { background: #f5f5f5; padding: 2px 6px; border-radius: 3px; font-family: 'Courier New', monospace; }
                    pre { background: #f5f5f5; padding: 16px; border-radius: 4px; overflow-x: auto; }
                    table { border-collapse: collapse; width: 100%; margin: 16px 0; }
                    th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
                    th { background: #f5f5f5; font-weight: 600; }
                    img { max-width: 100%; height: auto; }
                    ul, ol { padding-left: 24px; }
                    li { margin-bottom: 4px; }
                </style>
            </head>
            <body>
                <h1>${escapeHTML(file.title)}</h1>
                <div id="content"></div>
            </body>
            </html>
        `

        await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(htmlContent))
        
        const safeContent = JSON.stringify(file.content || '')
        const contentDiv = await win.webContents.executeJavaScript(`
            (function() {
                const content = ${safeContent}
                const container = document.getElementById('content')
                try {
                    const state = JSON.parse(content)
                    const html = convertLexicalToHTML(state)
                    container.innerHTML = html
                } catch(e) {
                    container.innerHTML = '<p>' + content.replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</p>'
                }
                return container.innerHTML
            })()
        `)

        await win.webContents.executeJavaScript(`
            function convertLexicalToHTML(state) {
                if (!state.root || !state.root.children) return ''
                return state.root.children.map(node => convertNode(node)).join('')
            }
            function convertNode(node) {
                if (!node.type) return ''
                switch(node.type) {
                    case 'heading':
                        const tag = node.tag || 'h1'
                        return '<' + tag + '>' + convertChildren(node.children) + '</' + tag + '>'
                    case 'paragraph':
                        return '<p>' + convertChildren(node.children) + '</p>'
                    case 'quote':
                        return '<blockquote>' + convertChildren(node.children) + '</blockquote>'
                    case 'list':
                        const listTag = node.listType === 'number' ? 'ol' : 'ul'
                        return '<' + listTag + '>' + node.children.map(item => '<li>' + convertChildren(item.children) + '</li>').join('') + '</' + listTag + '>'
                    case 'code':
                    case 'code-block':
                        return '<pre><code>' + convertChildren(node.children) + '</code></pre>'
                    case 'image':
                        return '<img src="' + (node.src || '').replace(/"/g, '&quot;') + '" alt="' + (node.alt || '').replace(/"/g, '&quot;') + '">'
                    case 'table':
                        return convertTable(node)
                    default:
                        if (node.children) return convertChildren(node.children)
                        return ''
                }
            }
            function convertChildren(children) {
                if (!children) return ''
                return children.map(child => {
                    if (child.type === 'text') {
                        let text = (child.text || '').replace(/</g, '&lt;').replace(/>/g, '&gt;')
                        const f = child.format || 0
                        if (f & 16) return '<code>' + text + '</code>'
                        if (f & 8) text = '<s>' + text + '</s>'
                        if (f & 2) text = '<em>' + text + '</em>'
                        if (f & 1) text = '<strong>' + text + '</strong>'
                        return text
                    }
                    if (child.type === 'link') return '<a href="' + (child.url || '').replace(/"/g, '&quot;') + '">' + convertChildren(child.children) + '</a>'
                    if (child.type === 'linebreak') return '<br>'
                    return ''
                }).join('')
            }
            function convertTable(node) {
                if (!node.children) return ''
                let html = '<table>'
                node.children.forEach((row, i) => {
                    html += '<tr>'
                    row.children.forEach(cell => {
                        const tag = i === 0 ? 'th' : 'td'
                        html += '<' + tag + '>' + convertChildren(cell.children) + '</' + tag + '>'
                    })
                    html += '</tr>'
                })
                html += '</table>'
                return html
            }
        `)

        const pdfBuffer = await win.webContents.printToPDF({
            pageSize: 'A4',
            margins: { top: 20, bottom: 20, left: 20, right: 20 }
        })

        fs.writeFileSync(outputPath, pdfBuffer)
        return outputPath
    } finally {
        if (!win.isDestroyed()) {
            win.close()
        }
    }
}

export async function exportToHTML(file, outputPath) {
    const htmlContent = convertLexicalToFullHTML(file)
    fs.writeFileSync(outputPath, htmlContent, 'utf-8')
    return outputPath
}

function convertLexicalToFullHTML(file) {
    let bodyHTML = ''
    try {
        const state = JSON.parse(file.content || '')
        bodyHTML = state.root ? convertLexicalRootToHTML(state.root) : `<p>${escapeHTML(file.content)}</p>`
    } catch {
        bodyHTML = `<p>${escapeHTML(file.content || '')}</p>`
    }

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${escapeHTML(file.title)}</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; max-width: 800px; margin: 40px auto; padding: 0 20px; line-height: 1.6; color: #333; }
        h1 { border-bottom: 2px solid #eee; padding-bottom: 10px; }
        h1, h2, h3, h4 { margin-top: 24px; margin-bottom: 12px; }
        p { margin-bottom: 12px; }
        blockquote { border-left: 4px solid #ddd; padding-left: 16px; color: #666; margin: 16px 0; }
        code { background: #f5f5f5; padding: 2px 6px; border-radius: 3px; font-family: 'Courier New', Consolas, monospace; font-size: 0.9em; }
        pre { background: #f5f5f5; padding: 16px; border-radius: 4px; overflow-x: auto; }
        pre code { background: none; padding: 0; }
        table { border-collapse: collapse; width: 100%; margin: 16px 0; }
        th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
        th { background: #f5f5f5; font-weight: 600; }
        img { max-width: 100%; height: auto; border-radius: 4px; }
        ul, ol { padding-left: 24px; }
        li { margin-bottom: 4px; }
        a { color: #0366d6; text-decoration: none; }
        a:hover { text-decoration: underline; }
        hr { border: none; border-top: 1px solid #eee; margin: 24px 0; }
    </style>
</head>
<body>
    <h1>${escapeHTML(file.title)}</h1>
    ${bodyHTML}
</body>
</html>`
}

function convertLexicalRootToHTML(root) {
    if (!root.children) return ''
    return root.children.map(node => convertNodeToHTML(node)).join('')
}

function convertNodeToHTML(node) {
    if (!node || !node.type) return ''
    switch (node.type) {
        case 'heading':
            const tag = node.tag || 'h1'
            return `<${tag}>${convertChildrenToHTML(node.children)}</${tag}>`
        case 'paragraph':
            return `<p>${convertChildrenToHTML(node.children)}</p>`
        case 'quote':
            return `<blockquote>${convertChildrenToHTML(node.children)}</blockquote>`
        case 'list':
            const listTag = node.listType === 'number' ? 'ol' : 'ul'
            return `<${listTag}>${node.children.map(item => `<li>${convertChildrenToHTML(item.children)}</li>`).join('')}</${listTag}>`
        case 'code':
        case 'code-block':
            const lang = node.language ? ` class="language-${node.language}"` : ''
            return `<pre><code${lang}>${escapeHTML(convertChildrenToHTML(node.children))}</code></pre>`
        case 'image':
            return `<img src="${node.src || ''}" alt="${escapeHTML(node.alt || '')}">`
        case 'image-grid':
            return `<div class="image-grid">${node.children.map(img => `<img src="${img.src || ''}" alt="${escapeHTML(img.alt || '')}">`).join('')}</div>`
        case 'table':
            return convertTableToHTML(node)
        case 'divider':
            return '<hr>'
        case 'todo':
            const checked = node.checked ? 'checked' : ''
            return `<p><input type="checkbox" disabled ${checked}> ${convertChildrenToHTML(node.children)}</p>`
        default:
            if (node.children) return convertChildrenToHTML(node.children)
            return ''
    }
}

function convertChildrenToHTML(children) {
    if (!children) return ''
    return children.map(child => {
        if (child.type === 'text') {
            let text = escapeHTML(child.text || '')
            const f = child.format || 0
            if (f & 16) return `<code>${text}</code>`
            if (f & 8) text = `<s>${text}</s>`
            if (f & 2) text = `<em>${text}</em>`
            if (f & 1) text = `<strong>${text}</strong>`
            return text
        }
        if (child.type === 'link') return `<a href="${child.url || ''}">${convertChildrenToHTML(child.children)}</a>`
        if (child.type === 'linebreak') return '<br>'
        return ''
    }).join('')
}

function convertTableToHTML(node) {
    if (!node.children) return ''
    let html = '<table>'
    node.children.forEach((row, i) => {
        html += '<tr>'
        row.children.forEach(cell => {
            const tag = i === 0 ? 'th' : 'td'
            html += `<${tag}>${convertChildrenToHTML(cell.children)}</${tag}>`
        })
        html += '</tr>'
    })
    html += '</table>'
    return html
}

function escapeHTML(str) {
    if (!str) return ''
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
