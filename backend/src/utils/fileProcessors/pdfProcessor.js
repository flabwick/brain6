const fs = require('fs-extra');
const path = require('path');

/**
 * PDF File Processor (Placeholder Implementation)
 * Currently returns metadata only - text extraction to be implemented later
 */

/**
 * Extract basic metadata from PDF file
 * @param {string} filePath - Path to PDF file
 * @returns {Promise<Object>} - Basic PDF metadata
 */
async function extractPdfMetadata(filePath) {
  const stats = await fs.stat(filePath);
  const fileName = path.basename(filePath, path.extname(filePath));
  
  // Basic metadata that we can determine without PDF parsing
  const metadata = {
    fileName,
    fileSize: stats.size,
    fileType: 'pdf',
    modified: stats.mtime,
    created: stats.birthtime || stats.ctime,
    // Placeholder values - would be extracted from PDF in full implementation
    pageCount: null,
    title: null,
    author: null,
    subject: null,
    creator: null,
    producer: null,
    creationDate: null,
    modificationDate: null,
    encrypted: false,
    version: null
  };

  return metadata;
}

/**
 * Generate card title from PDF filename
 * @param {string} fileName - PDF filename
 * @param {Object} metadata - PDF metadata
 * @returns {string} - Generated title
 */
function generateTitle(fileName, metadata) {
  // Use PDF title metadata if available (would be implemented later)
  if (metadata.title && metadata.title.trim().length > 0) {
    return metadata.title.trim();
  }

  // Clean up filename for title
  const baseName = path.basename(fileName, path.extname(fileName));
  return baseName
    .replace(/[-_]/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

/**
 * Process a PDF file (placeholder implementation)
 * @param {string} filePath - Path to the PDF file
 * @param {Object} options - Processing options
 * @param {string} options.title - Custom title (optional)
 * @returns {Promise<Object>} - Processed PDF data
 */
async function processPdfFile(filePath, options = {}) {
  try {
    if (!(await fs.pathExists(filePath))) {
      throw new Error(`File not found: ${filePath}`);
    }

    // Extract basic metadata
    const metadata = await extractPdfMetadata(filePath);
    
    // Generate title
    const title = options.title || generateTitle(path.basename(filePath), metadata);
    
    // Create placeholder content indicating this is a PDF reference
    const content = `# ${title}

**File Type:** PDF Document  
**File Size:** ${(metadata.fileSize / 1024 / 1024).toFixed(2)} MB  
**Last Modified:** ${metadata.modified.toLocaleDateString()}  

*This is a reference card for a PDF file. Full text extraction is not yet implemented.*

**File Location:** \`${filePath}\`

## Future Features
- Text extraction from PDF pages
- Page-by-page content breakdown
- Image extraction
- Searchable content indexing

---
*To view the full PDF content, open the file directly from the file system.*`;

    return {
      title,
      content,
      metadata: {
        ...metadata,
        contentType: 'pdf-reference',
        wordCount: 0, // No text content extracted yet
        characterCount: content.length,
        isPlaceholder: true
      },
      fileInfo: {
        path: filePath,
        size: metadata.fileSize,
        modified: metadata.modified,
        created: metadata.created
      },
      processingInfo: {
        processor: 'pdf-placeholder',
        processedAt: new Date(),
        contentLength: content.length,
        textExtracted: false,
        note: 'PDF text extraction not yet implemented'
      }
    };

  } catch (error) {
    console.error(`❌ Error processing PDF file ${filePath}:`, error.message);
    throw new Error(`Failed to process PDF file: ${error.message}`);
  }
}

/**
 * Validate PDF file
 * @param {string} filePath - Path to validate
 * @returns {Promise<boolean>} - True if valid PDF file
 */
async function validatePdfFile(filePath) {
  try {
    const ext = path.extname(filePath).toLowerCase();
    if (ext !== '.pdf') {
      return false;
    }

    if (!(await fs.pathExists(filePath))) {
      return false;
    }

    const stats = await fs.stat(filePath);
    if (!stats.isFile()) {
      return false;
    }

    // Check file size (warn if > 100MB)
    if (stats.size > 100 * 1024 * 1024) {
      console.warn(`⚠️  PDF file is very large: ${filePath} (${(stats.size / 1024 / 1024).toFixed(2)} MB)`);
    }

    // Quick validation - check if file starts with PDF header
    const buffer = await fs.readFile(filePath, { encoding: null, start: 0, end: 8 });
    const header = buffer.toString('ascii', 0, 4);
    
    if (header !== '%PDF') {
      console.warn(`⚠️  File does not appear to be a valid PDF: ${filePath}`);
      return false;
    }

    return true;
  } catch (error) {
    console.error(`❌ Error validating PDF file ${filePath}:`, error.message);
    return false;
  }
}

/**
 * Get supported file extensions
 * @returns {Array<string>} - Array of supported extensions
 */
function getSupportedExtensions() {
  return ['.pdf'];
}

/**
 * Check if full PDF text extraction is available
 * @returns {boolean} - True if text extraction is implemented
 */
function isTextExtractionAvailable() {
  return false; // Placeholder implementation
}

module.exports = {
  processPdfFile,
  validatePdfFile,
  getSupportedExtensions,
  extractPdfMetadata,
  generateTitle,
  isTextExtractionAvailable
};