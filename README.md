# About
The goal of this package is to imitate `tail -F | grep` functionality in node.

This is the simplest way to tail a file, filter the output, and run a function. The program will continue to tail the file until the process is killed. Because it follows the file by path (not by descriptor), it keeps working across log rotation — it will continue tailing even if the file is rotated, truncated, deleted, or recreated.

## Usage
```js
new Tail(filepath, keywords, excludeKeywords, callback);
```

All four arguments are required, in this order:

| Argument          | Type       | Description                                                                                  |
| ----------------- | ---------- | -------------------------------------------------------------------------------------------- |
| `filepath`        | `string`   | Path to the file to follow.                                                                  |
| `keywords`        | `string[]` | Only changes containing at least one of these strings are reported. Pass `[]` to report all. |
| `excludeKeywords` | `string[]` | Changes containing any of these strings are skipped. Pass `[]` to exclude nothing.           |
| `callback`        | `function` | Called with the new text for each reported change.                                           |

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
