# About
The goal of this package is to imitate `tail -F | grep` functionality in node.

This is the simplest way to tail a file, filter the output, and run a function. The program will continue to tail the file until the process is killed. Because it follows the file by path (not by descriptor), it keeps working across log rotation — it will continue tailing even if the file is rotated, truncated, deleted, or recreated.

## Usage
```js
new Tail(filepath, keywords, excludeKeywords, callback, options);
```

The first four arguments are required, in this order:

| Argument          | Type       | Description                                                                                  |
| ----------------- | ---------- | -------------------------------------------------------------------------------------------- |
| `filepath`        | `string`   | Path to the file to follow.                                                                  |
| `keywords`        | `string[]` | Only changes containing at least one of these strings are reported. Pass `[]` to report all. |
| `excludeKeywords` | `string[]` | Changes containing any of these strings are skipped. Pass `[]` to exclude nothing.           |
| `callback`        | `function` | Called with the new text for each reported change.                                           |
| `options`         | `object`   | Optional. See [Options](#options).                                                           |

## Reporting every change
The below code will tail the file `/var/log/my-app.log` and print the contents of each change to the console.

```js
const Tail = require('tailf-grep');
const fn = changes => { console.log(changes); };
const tail = new Tail('/var/log/my-app.log', [], [], fn);
```

## Filtering by keyword
The below code will tail the file `/var/log/my-app.log` and print the contents of each change to the console provided that the change contains a string in the `keywords` array.

```js
const Tail = require('tailf-grep');
const fn = changes => { console.error(changes); };
const tail = new Tail('/var/log/my-app.log', ['ERROR', 'WARNING'], [], fn);
```

## Excluding text
You can also tell the tailer to ignore certain text via the `excludeKeywords` array. The below code reports changes that contain a `keywords` string **and** do not contain an `excludeKeywords` string.

```js
const Tail = require('tailf-grep');
const fn = changes => { console.error(changes); };
const tail = new Tail('/var/log/my-app.log', ['ERROR', 'WARNING'], ['exclude me', 'definitely don\'t report me'], fn);
```

## Grouping multi-line records
By default each batch of new content is filtered as a single unit. That has two consequences: a multi-line entry (e.g. a stack trace) may be split, and if two log entries are written close together, one entry's exclude string can suppress the other entry — they're matched as one blob.

Set `options.blockStart` to tell the tailer where a new log record begins. It is matched against the **start of each line**: a line that matches begins a new record, and every other line is treated as a continuation of the current record. Each record is then filtered **independently**, so a multi-line entry stays whole and noise in one record can't hide a match in another.

```js
const Tail = require('tailf-grep');
const fn = record => { console.error(record); };

// A new record begins on any line starting with a timestamp like "2026-06-11 12:00:00".
const tail = new Tail(
  '/var/log/my-app.log',
  ['ERROR'],
  ['known noise'],
  fn,
  { blockStart: /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/ }
);
```

`blockStart` may be a `RegExp` (tested against each line) or a `string` (the line must start with it).

## Options
| Option       | Type              | Default        | Description                                                                                                                |
| ------------ | ----------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `blockStart` | `RegExp \| string`| _none_         | Marks the first line of a new log record so multi-line records stay whole and are filtered independently. See above.       |
| `interval`   | `number` (ms)     | `1000`         | How often the file is polled for changes.                                                                                  |
| `flushDelay` | `number` (ms)     | `interval * 2` | With `blockStart`, how long to wait for more lines before emitting a trailing record. Ignored without `blockStart`.        |
