function escapeHtml(str) {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
function escapeAttr(str) {
    return escapeHtml(str);
}
const SHORTLINK_EXACT_RE = /^(go\/[a-zA-Z0-9._/-]+(?:#[a-zA-Z0-9._/-]+)?|(?:cl|b)\/[0-9]+)$/;
const EMAIL_ONLY_RE = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
function normalizeUrl(rawUrl) {
    const trimmed = rawUrl.trim();
    if (SHORTLINK_EXACT_RE.test(trimmed)) {
        return `http://${trimmed}`;
    }
    return trimmed;
}
function extractEmailAddress(addr) {
    const m = addr.match(/<([^>]+)>/);
    return (m ? m[1] : addr).trim().toLowerCase();
}
export function compileMarkdownEmail(markdown, existingTo = [], existingCc = [], existingBcc = []) {
    const knownRecipients = new Set([...existingTo, ...existingCc, ...existingBcc].map(extractEmailAddress));
    const mergedCc = [...existingCc];
    let chipCounter = 0;
    function registerMention(displayText, email) {
        const cleanEmail = email.replace(/^mailto:/i, '').trim();
        const lower = cleanEmail.toLowerCase();
        if (!knownRecipients.has(lower)) {
            knownRecipients.add(lower);
            mergedCc.push(cleanEmail);
        }
        const chipId = `plusReplyChip-${chipCounter++}`;
        const label = displayText.startsWith('+') || displayText.startsWith('@')
            ? displayText
            : `+${displayText}`;
        const html = `<a class="gmail_plusreply" id="${chipId}" href="mailto:${escapeAttr(cleanEmail)}" tabindex="-1">${escapeHtml(label)}</a>`;
        const text = label.includes(cleanEmail) ? label : `${label} <${cleanEmail}>`;
        return { html, text };
    }
    function renderProseSegment(seg) {
        // Replace prose arrows
        const withArrows = seg
            .replace(/ -> /g, ' → ')
            .replace(/ <- /g, ' ← ');
        // Match angle-bracket mentions, bare +email mentions, bare URLs, or bare shortlinks
        const tokenRe = /(^|[\s([,;])(?:([+@][A-Za-z0-9_.\u00C0-\u024F-]+(?:\s+[A-Za-z0-9_.\u00C0-\u024F-]+){0,4})\s*<([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})>|([+@])([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})(?=$|[\s)\],.;!?])|(https?:\/\/[^\s<>[\]]+)|(go\/[a-zA-Z0-9._/-]+(?:#[a-zA-Z0-9._/-]+)?|(?:cl|b)\/[0-9]+))/g;
        let htmlOut = '';
        let textOut = '';
        let lastIndex = 0;
        let match;
        while ((match = tokenRe.exec(withArrows)) !== null) {
            const [full, prefix, angleName, angleEmail, bareSigil, bareEmail, rawUrl, rawShortlink] = match;
            const before = withArrows.slice(lastIndex, match.index) + prefix;
            htmlOut += escapeHtml(before);
            textOut += before;
            if (angleName && angleEmail) {
                const m = registerMention(angleName.trim(), angleEmail);
                htmlOut += m.html;
                textOut += m.text;
            }
            else if (bareSigil && bareEmail) {
                const m = registerMention(`${bareSigil}${bareEmail}`, bareEmail);
                htmlOut += m.html;
                textOut += m.text;
            }
            else if (rawUrl) {
                // Strip trailing punctuation and unbalanced closing parens
                let url = rawUrl;
                let trailing = '';
                while (/[.,;:!?]$/.test(url) || (url.endsWith(')') && (url.match(/\(/g)?.length ?? 0) < (url.match(/\)/g)?.length ?? 0))) {
                    trailing = url.slice(-1) + trailing;
                    url = url.slice(0, -1);
                }
                htmlOut += `<a href="${escapeAttr(url)}">${escapeHtml(url)}</a>${escapeHtml(trailing)}`;
                textOut += `${url}${trailing}`;
            }
            else if (rawShortlink) {
                let shortlink = rawShortlink;
                let trailing = '';
                while (/[.,;:!?]$/.test(shortlink)) {
                    trailing = shortlink.slice(-1) + trailing;
                    shortlink = shortlink.slice(0, -1);
                }
                const href = `http://${shortlink}`;
                htmlOut += `<a href="${escapeAttr(href)}">${escapeHtml(shortlink)}</a>${escapeHtml(trailing)}`;
                textOut += `${shortlink}${trailing}`;
            }
            lastIndex = match.index + full.length;
        }
        const rest = withArrows.slice(lastIndex);
        htmlOut += escapeHtml(rest);
        textOut += rest;
        return { html: htmlOut, text: textOut };
    }
    function renderInline(input, insideLink = false) {
        // Tokenize top-level inline constructs:
        // 1. Inline code: `...`
        // 2. Markdown link: [label](target)
        // 3. Bold: **...**
        // 4. Italic: *...* (not preceded/followed by space)
        const inlineRe = /(`[^`]+`)|(\[(?:[^\[\]]|`[^`]*`)*\]\([^()\s]+\))|(\*\*[^*]+\*\*)|((?<!\*)\*(?![*\s])(?:[^*]+)(?<![*\s])\*(?!\*))/g;
        let htmlOut = '';
        let textOut = '';
        let lastIndex = 0;
        let match;
        while ((match = inlineRe.exec(input)) !== null) {
            const prose = input.slice(lastIndex, match.index);
            if (prose) {
                const p = renderProseSegment(prose);
                htmlOut += p.html;
                textOut += p.text;
            }
            const [full, codeSpan, mdLink, boldSpan, italicSpan] = match;
            if (codeSpan) {
                const inner = codeSpan.slice(1, -1);
                if (!insideLink && SHORTLINK_EXACT_RE.test(inner)) {
                    const href = `http://${inner}`;
                    htmlOut += `<a href="${escapeAttr(href)}"><code>${escapeHtml(inner)}</code></a>`;
                }
                else {
                    htmlOut += `<code>${escapeHtml(inner)}</code>`;
                }
                textOut += inner;
            }
            else if (mdLink) {
                const closeBracket = mdLink.lastIndexOf('](');
                const rawLabel = mdLink.slice(1, closeBracket);
                const rawTarget = mdLink.slice(closeBracket + 2, -1).trim();
                const cleanTarget = rawTarget.replace(/^mailto:/i, '');
                // Check if this is a +Name / @Name mention link
                if ((rawLabel.startsWith('+') || rawLabel.startsWith('@')) && EMAIL_ONLY_RE.test(cleanTarget)) {
                    const m = registerMention(rawLabel, cleanTarget);
                    htmlOut += m.html;
                    textOut += m.text;
                }
                else {
                    const url = normalizeUrl(rawTarget);
                    const renderedLabel = renderInline(rawLabel, true);
                    htmlOut += `<a href="${escapeAttr(url)}">${renderedLabel.html}</a>`;
                    const strippedLabel = renderedLabel.text.trim();
                    if (strippedLabel === rawTarget ||
                        strippedLabel === url ||
                        `http://${strippedLabel}` === url ||
                        `https://${strippedLabel}` === url ||
                        `mailto:${strippedLabel}` === url) {
                        textOut += strippedLabel;
                    }
                    else {
                        textOut += `${strippedLabel} (${url})`;
                    }
                }
            }
            else if (boldSpan) {
                const inner = boldSpan.slice(2, -2);
                const rendered = renderInline(inner, insideLink);
                htmlOut += `<b>${rendered.html}</b>`;
                textOut += rendered.text;
            }
            else if (italicSpan) {
                const inner = italicSpan.slice(1, -1);
                const rendered = renderInline(inner, insideLink);
                htmlOut += `<i>${rendered.html}</i>`;
                textOut += rendered.text;
            }
            lastIndex = match.index + full.length;
        }
        const tail = input.slice(lastIndex);
        if (tail) {
            const p = renderProseSegment(tail);
            htmlOut += p.html;
            textOut += p.text;
        }
        return { html: htmlOut, text: textOut };
    }
    const lines = markdown.replace(/\r\n/g, '\n').split('\n');
    const htmlBlocks = [];
    const textBlocks = [];
    let i = 0;
    while (i < lines.length) {
        const line = lines[i];
        // Skip blank lines
        if (line.trim() === '') {
            i++;
            continue;
        }
        // Fenced code block
        if (line.trim().startsWith('```')) {
            i++;
            const codeLines = [];
            while (i < lines.length && !lines[i].trim().startsWith('```')) {
                codeLines.push(lines[i]);
                i++;
            }
            if (i < lines.length)
                i++; // skip closing ```
            const codeContent = codeLines.join('\n');
            htmlBlocks.push(`<pre><code>${escapeHtml(codeContent)}</code></pre>`);
            textBlocks.push(codeContent);
            continue;
        }
        // Heading
        const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
        if (headingMatch) {
            const level = headingMatch[1].length;
            const rendered = renderInline(headingMatch[2].trim());
            htmlBlocks.push(`<h${level}>${rendered.html}</h${level}>`);
            textBlocks.push(rendered.text);
            i++;
            continue;
        }
        // Unordered list
        if (/^\s*[-*]\s+/.test(line)) {
            const itemsHtml = [];
            const itemsText = [];
            while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
                const itemParts = [lines[i].replace(/^\s*[-*]\s+/, '').trim()];
                i++;
                while (i < lines.length &&
                    lines[i].trim() !== '' &&
                    !/^\s*[-*]\s+/.test(lines[i]) &&
                    !/^\s*\d+\.\s+/.test(lines[i]) &&
                    !/^#{1,6}\s+/.test(lines[i]) &&
                    !lines[i].trim().startsWith('```') &&
                    /^\s{2,}/.test(lines[i])) {
                    itemParts.push(lines[i].trim());
                    i++;
                }
                const rendered = renderInline(itemParts.join(' '));
                itemsHtml.push(`  <li>${rendered.html}</li>`);
                itemsText.push(`- ${rendered.text}`);
            }
            htmlBlocks.push(`<ul>\n${itemsHtml.join('\n')}\n</ul>`);
            textBlocks.push(itemsText.join('\n'));
            continue;
        }
        // Ordered list
        if (/^\s*\d+\.\s+/.test(line)) {
            const itemsHtml = [];
            const itemsText = [];
            let num = 1;
            while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
                const itemParts = [lines[i].replace(/^\s*\d+\.\s+/, '').trim()];
                i++;
                while (i < lines.length &&
                    lines[i].trim() !== '' &&
                    !/^\s*[-*]\s+/.test(lines[i]) &&
                    !/^\s*\d+\.\s+/.test(lines[i]) &&
                    !/^#{1,6}\s+/.test(lines[i]) &&
                    !lines[i].trim().startsWith('```') &&
                    /^\s{2,}/.test(lines[i])) {
                    itemParts.push(lines[i].trim());
                    i++;
                }
                const rendered = renderInline(itemParts.join(' '));
                itemsHtml.push(`  <li>${rendered.html}</li>`);
                itemsText.push(`${num++}. ${rendered.text}`);
            }
            htmlBlocks.push(`<ol>\n${itemsHtml.join('\n')}\n</ol>`);
            textBlocks.push(itemsText.join('\n'));
            continue;
        }
        // Blockquote
        if (/^\s*>\s?/.test(line)) {
            const quoteLines = [];
            while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
                quoteLines.push(lines[i].replace(/^\s*>\s?/, ''));
                i++;
            }
            const rendered = renderInline(quoteLines.join(' '));
            htmlBlocks.push(`<blockquote>${rendered.html}</blockquote>`);
            textBlocks.push(quoteLines.map(q => `> ${renderInline(q).text}`).join('\n'));
            continue;
        }
        // Paragraph
        const paraLines = [];
        while (i < lines.length &&
            lines[i].trim() !== '' &&
            !lines[i].trim().startsWith('```') &&
            !/^#{1,6}\s+/.test(lines[i]) &&
            !/^\s*[-*]\s+/.test(lines[i]) &&
            !/^\s*\d+\.\s+/.test(lines[i]) &&
            !/^\s*>\s?/.test(lines[i])) {
            paraLines.push(lines[i].trim());
            i++;
        }
        const rendered = renderInline(paraLines.join(' '));
        htmlBlocks.push(`<p>${rendered.html}</p>`);
        textBlocks.push(rendered.text);
    }
    return {
        text: textBlocks.join('\n\n'),
        html: `<div dir="ltr">\n${htmlBlocks.join('\n\n')}\n</div>`,
        cc: mergedCc,
    };
}
