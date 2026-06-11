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

// Build a predicate that decides whether a line begins a new log record. Accepts a
// RegExp (tested against the line) or a string (the line must start with it). Returns
// null when no block matcher is configured (the whole change is treated as one unit).
const blockStarter = blockStart => {
	if (blockStart instanceof RegExp) return line => blockStart.test(line);
	if (typeof blockStart === 'string') return line => line.startsWith(blockStart);
	return null;
};

const tailF_grep = (filepath, keywords, excludeKeywords, callback, options = {}) => {
	const interval = options.interval || 1000;
	const startsBlock = blockStarter(options.blockStart);
	const flushDelay = options.flushDelay || interval * 2;

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

	// In block mode a record can span polls, so `carry` holds the trailing, not-yet-complete
	// record until the next record begins (or `flushDelay` elapses with no new writes).
	let carry = '';
	let flushTimer = null;

	const report = record => {
		if (record.length > 0
			&& (keywords.length === 0 || strContains(record, keywords))
			&& (excludeKeywords.length === 0 || !strContains(record, excludeKeywords))) {
			callback(record);
		}
	};

	// Emit the held record if no further lines arrive — otherwise the last record of a burst
	// would never be reported (watchFile only fires again when the file actually changes).
	const scheduleFlush = () => {
		if (flushTimer) clearTimeout(flushTimer);
		if (carry.length === 0) {
			flushTimer = null;
			return;
		}
		flushTimer = setTimeout(() => {
			flushTimer = null;
			const pending = carry;
			carry = '';
			report(pending);
		}, flushDelay);
		if (flushTimer.unref) flushTimer.unref();
	};

	const flushCarry = () => {
		if (flushTimer) {
			clearTimeout(flushTimer);
			flushTimer = null;
		}
		if (carry.length === 0) return;
		const pending = carry;
		carry = '';
		report(pending);
	};

	// Feed newly-read text through the filter. Without a block matcher the whole piece is one
	// unit (1.0.x behaviour). With one, it is split into records that are each filtered
	// independently, so noise in one record cannot suppress a real match in another.
	const consume = text => {
		if (!startsBlock) {
			report(text);
			return;
		}
		const lines = (carry + text).split('\n');
		const starts = [];
		for (let i = 0; i < lines.length; i++) {
			if (startsBlock(lines[i])) starts.push(i);
		}
		if (starts.length === 0) {
			// No record boundary seen yet — keep buffering until one appears.
			carry = lines.join('\n');
			scheduleFlush();
			return;
		}
		// Any lines before the first boundary are a leftover fragment; emit so nothing is lost.
		if (starts[0] > 0) {
			report(lines.slice(0, starts[0]).join('\n'));
		}
		// Every record up to (but not including) the last boundary is complete.
		for (let s = 0; s < starts.length - 1; s++) {
			report(lines.slice(starts[s], starts[s + 1]).join('\n'));
		}
		// The final record may still be growing; hold it until the next record or a flush.
		carry = lines.slice(starts[starts.length - 1]).join('\n');
		scheduleFlush();
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
				// Rotated: the path now points to a brand-new file. The in-flight record on the
				// old file is finished, so flush it, then read the new file from the start.
				flushCarry();
				consume(readRange(filepath, 0, curr.size));
				offset = curr.size;
				ino = curr.ino;
				return;
			}

			if (curr.size < offset) {
				// Same file, smaller than before: truncated in place (logrotate copytruncate).
				flushCarry();
				consume(readRange(filepath, 0, curr.size));
				offset = curr.size;
				return;
			}

			if (curr.size > offset) {
				consume(readRange(filepath, offset, curr.size));
				offset = curr.size;
			}
		} catch (error) {
			// Transient error (e.g. the file vanished mid-read during rotation).
			// Leave the baseline untouched and let the next poll recover.
		}
	});
};

// All four leading arguments are required. keywords/excludeKeywords are arrays (use []
// for none); callback is always the 4th argument. `options` is optional:
//   options.blockStart  RegExp | string — a new log record begins at any line matching this;
//                       other lines are continuations. Lets multi-line records (e.g. stack
//                       traces) be kept whole and filtered independently of their neighbours.
//   options.interval    number (ms) — poll interval, default 1000.
//   options.flushDelay  number (ms) — how long to wait for more lines before emitting a
//                       trailing record, default interval * 2 (only used with blockStart).
function Tail(filepath, keywords, excludeKeywords, callback, options = {}) {
	if (typeof filepath !== 'string') {
		throw new TypeError('tailf-grep: filepath must be a string path to the file to follow');
	}
	if (!Array.isArray(keywords) || !Array.isArray(excludeKeywords)) {
		throw new TypeError('tailf-grep: keywords and excludeKeywords must be arrays (use [] for none)');
	}
	if (typeof callback !== 'function') {
		throw new TypeError('tailf-grep: callback (4th argument) must be a function');
	}
	if (options.blockStart !== undefined
		&& !(options.blockStart instanceof RegExp) && typeof options.blockStart !== 'string') {
		throw new TypeError('tailf-grep: options.blockStart must be a RegExp or string');
	}
	this.tail = tailF_grep(filepath, keywords, excludeKeywords, callback, options);
}

module.exports = Tail;
