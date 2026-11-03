import fs from 'fs';
import path from 'path';
import nodemailer from 'nodemailer';
import { compileMarkdownEmail } from './markdown.js';
/**
 * Helper function to encode email headers containing non-ASCII characters
 * according to RFC 2047 MIME specification
 */
function encodeEmailHeader(text) {
    // Only encode if the text contains non-ASCII characters
    if (/[^\x00-\x7F]/.test(text)) {
        // Use MIME Words encoding (RFC 2047)
        return '=?UTF-8?B?' + Buffer.from(text).toString('base64') + '?=';
    }
    return text;
}
export const validateEmail = (email) => {
    const trimmed = email.trim();
    const angleMatch = trimmed.match(/<([^>]+)>$/);
    const addr = angleMatch ? angleMatch[1].trim() : trimmed;
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(addr);
};
export function prepareEmailArgs(validatedArgs) {
    const args = { ...validatedArgs };
    if (!args.htmlBody && args.mimeType !== 'text/plain') {
        const compiled = compileMarkdownEmail(args.body || '', args.to || [], args.cc || [], args.bcc || []);
        args.body = compiled.text;
        args.htmlBody = compiled.html;
        args.cc = compiled.cc.length > 0 ? compiled.cc : undefined;
        args.mimeType = 'multipart/alternative';
    }
    else if (args.htmlBody && !args.mimeType) {
        args.mimeType = 'multipart/alternative';
    }
    return args;
}
export function createEmailMessage(validatedArgs) {
    const args = prepareEmailArgs(validatedArgs);
    const encodedSubject = encodeEmailHeader(args.subject);
    let mimeType = args.mimeType || 'multipart/alternative';
    if (args.htmlBody && mimeType !== 'text/plain' && mimeType !== 'text/html') {
        mimeType = 'multipart/alternative';
    }
    // Generate a random boundary string for multipart messages
    const boundary = `----=_NextPart_${Math.random().toString(36).substring(2)}`;
    // Validate email addresses
    args.to.forEach(email => {
        if (!validateEmail(email)) {
            throw new Error(`Recipient email address is invalid: ${email}`);
        }
    });
    // Common email headers
    const emailParts = [
        'From: me',
        `To: ${args.to.join(', ')}`,
        args.cc && args.cc.length > 0 ? `Cc: ${args.cc.join(', ')}` : '',
        args.bcc && args.bcc.length > 0 ? `Bcc: ${args.bcc.join(', ')}` : '',
        `Subject: ${encodedSubject}`,
        // Add thread-related headers if specified
        args.inReplyTo ? `In-Reply-To: ${args.inReplyTo}` : '',
        args.inReplyTo ? `References: ${args.inReplyTo}` : '',
        'MIME-Version: 1.0',
    ].filter(Boolean);
    // Construct the email based on the content type
    if (mimeType === 'multipart/alternative') {
        // Multipart email with both plain text and HTML
        emailParts.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
        emailParts.push('');
        // Plain text part
        emailParts.push(`--${boundary}`);
        emailParts.push('Content-Type: text/plain; charset=UTF-8');
        emailParts.push('Content-Transfer-Encoding: 8bit');
        emailParts.push('');
        emailParts.push(args.body);
        emailParts.push('');
        // HTML part
        emailParts.push(`--${boundary}`);
        emailParts.push('Content-Type: text/html; charset=UTF-8');
        emailParts.push('Content-Transfer-Encoding: 8bit');
        emailParts.push('');
        emailParts.push(args.htmlBody || args.body);
        emailParts.push('');
        // Close the boundary
        emailParts.push(`--${boundary}--`);
    }
    else if (mimeType === 'text/html') {
        // HTML-only email
        emailParts.push('Content-Type: text/html; charset=UTF-8');
        emailParts.push('Content-Transfer-Encoding: 8bit');
        emailParts.push('');
        emailParts.push(args.htmlBody || args.body);
    }
    else {
        // Plain text email
        emailParts.push('Content-Type: text/plain; charset=UTF-8');
        emailParts.push('Content-Transfer-Encoding: 8bit');
        emailParts.push('');
        emailParts.push(args.body);
    }
    return emailParts.join('\r\n');
}
export async function createEmailWithNodemailer(validatedArgs) {
    const args = prepareEmailArgs(validatedArgs);
    // Validate email addresses
    args.to.forEach(email => {
        if (!validateEmail(email)) {
            throw new Error(`Recipient email address is invalid: ${email}`);
        }
    });
    // Create a nodemailer transporter (we won't actually send, just generate the message)
    const transporter = nodemailer.createTransport({
        streamTransport: true,
        newline: 'unix',
        buffer: true
    });
    // Prepare attachments for nodemailer
    const attachments = [];
    for (const filePath of args.attachments) {
        if (!fs.existsSync(filePath)) {
            throw new Error(`File does not exist: ${filePath}`);
        }
        const fileName = path.basename(filePath);
        attachments.push({
            filename: fileName,
            path: filePath
        });
    }
    const mailOptions = {
        from: 'me', // Gmail API will replace this with the authenticated user
        to: args.to.join(', '),
        cc: args.cc?.join(', '),
        bcc: args.bcc?.join(', '),
        subject: args.subject,
        text: args.body,
        html: args.htmlBody,
        attachments: attachments,
        inReplyTo: args.inReplyTo,
        references: args.inReplyTo
    };
    // Generate the raw message
    const info = await transporter.sendMail(mailOptions);
    const rawMessage = info.message.toString();
    return rawMessage;
}
