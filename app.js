const fs = require('fs');

const strContains = (str, keywords) => {
	return keywords.some(keyword => str.includes(keyword));
};

// Read bytes [start, end) from the file at `filepath` and return them as a string.
const readRange = (filepath, start, end) => {
	if (end <= start) return '';
	const fd = fs.openSync(filepath, 'r');
	try {
		const buffer = Buffer.alloc(end - start);
		const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, start);
		return buffer.subarray(0, bytesRead).toString();
	} finally {
		fs.closeSync(fd);
	}
};

const tailF_grep = (filepath, keywords = [], excludeKeywords = [], callback, interval = 1000) => {
	// Track where we've read up to (byte offset) and which file we're reading (inode).
	// `ino === 0` means we have no baseline yet (file absent at startup).
	let offset = 0;
	let ino = 0;
	try {
		const stats = fs.statSync(filepath);
		offset = stats.size;
		ino = stats.ino;
	} catch (error) {
		// File doesn't exist yet; we'll baseline to it once it appears.
	}

	const emit = content => {
		if (content.length > 0
			&& (keywords.length === 0 || strContains(content, keywords))
			&& (excludeKeywords.length === 0 || !strContains(content, excludeKeywords))) {
			callback(content);
		}
	};

	// fs.watchFile polls the *path* (not a file descriptor), so it keeps firing across
	// rotations when the old file is renamed away and a new one is created in its place.
	// This is what gives us real `tail -F` semantics; fs.watch cannot, as it binds to the inode.
	fs.watchFile(filepath, { interval }, curr => {
		try {
			if (curr.ino === 0) {
				// File is currently absent (e.g. mid-rotation gap). Keep the old baseline and wait.
				return;
			}

			if (ino === 0) {
				// First time we've seen the file: baseline to its current end without emitting,
				// so we only report content written from here on.
				offset = curr.size;
				ino = curr.ino;
				return;
			}

			if (curr.ino !== ino) {
				// Rotated: the path now points to a brand-new file. Read it from the start.
				emit(readRange(filepath, 0, curr.size));
				offset = curr.size;
				ino = curr.ino;
				return;
			}

			if (curr.size < offset) {
				// Same file, smaller than before: truncated in place (logrotate copytruncate).
				emit(readRange(filepath, 0, curr.size));
				offset = curr.size;
				return;
			}

			if (curr.size > offset) {
				emit(readRange(filepath, offset, curr.size));
				offset = curr.size;
			}
		} catch (error) {
			// Transient error (e.g. the file vanished mid-read during rotation).
			// Leave the baseline untouched and let the next poll recover.
		}
	});
};

function Tail(filepath, keywords = [], excludeKeywords = [], callback) {
	this.tail = tailF_grep(filepath, keywords, excludeKeywords, callback);
}

module.exports = Tail;
