var Expression = require('./expression');
var Mustache = exports;

// Setup regex  assignments
// remove whitespace according to Mustache spec
var rIsWhitespace = /\S/;

Mustache.tags = {
    '#': 1, '^': 2, '<': 3, '@': 4,
    '/': 5, '%': 6, '>': 7, '=': 8, '_v': 9,
    '{': 10, '&': 11, '_t': 12
};

function scan(text, delimiters) {
    var len = text.length,
        IN_TEXT = 0,
        IN_TAG_TYPE = 1,
        IN_TAG = 2,
        state = IN_TEXT,
        tagType = null,
        tag = null,
        buf = '',
        tokens = [],
        seenTag = false,
        i = 0,
        lineStart = 0,
        otag = '{{',
        ctag = '}}';

    function addBuf() {
        if (buf.length > 0) {
            tokens.push({tag: '_t', text: new String(buf)});
            buf = '';
        }
    }

    function lineIsWhitespace() {
        var isAllWhitespace = true;
        for (var j = lineStart; j < tokens.length; j++) {
            isAllWhitespace =
                (Mustache.tags[tokens[j].tag] < Mustache.tags['_v']) ||
                (tokens[j].tag == '_t' && tokens[j].text.match(rIsWhitespace) === null);
            if (!isAllWhitespace) {
                return false;
            }
        }

        return isAllWhitespace;
    }

    function filterLine(haveSeenTag, noNewLine) {
        addBuf();

        if (haveSeenTag && lineIsWhitespace()) {
            for (var j = lineStart, next; j < tokens.length; j++) {
                if (tokens[j].text) {
                    if ((next = tokens[j + 1]) && next.tag == '>') {
                        // set indent to token value
                        next.indent = tokens[j].text.toString()
                    }
                    tokens.splice(j, 1);
                }
            }
        } else if (!noNewLine) {
            tokens.push({tag: '\n'});
        }

        seenTag = false;
        lineStart = tokens.length;
    }

    function changeDelimiters(text, index) {
        var close = '=' + ctag,
            closeIndex = text.indexOf(close, index),
            delimiters = trim(
                text.substring(text.indexOf('=', index) + 1, closeIndex)
            ).split(' ');

        otag = delimiters[0];
        ctag = delimiters[delimiters.length - 1];

        return closeIndex + close.length - 1;
    }

    function cleanTripleStache(token) {
        if (token.n.substr(token.n.length - 1) === '}') {
            token.n = token.n.substring(0, token.n.length - 1);
        }
    }

    function trim(s) {
        if (s.trim) {
            return s.trim();
        }

        return s.replace(/^\s*|\s*$/g, '');
    }

    function tagChange(tag, text, index) {
        if (text.charAt(index) != tag.charAt(0)) {
            return false;
        }

        for (var i = 1, l = tag.length; i < l; i++) {
            if (text.charAt(index + i) != tag.charAt(i)) {
                return false;
            }
        }

        return true;
    }

    if (delimiters) {
        delimiters = delimiters.split(' ');
        otag = delimiters[0];
        ctag = delimiters[1];
    }

    for (i = 0; i < len; i++) {
        if (state == IN_TEXT) {
            if (tagChange(otag, text, i)) {
                --i;
                addBuf();
                state = IN_TAG_TYPE;
            } else {
                if (text.charAt(i) == '\n') {
                    filterLine(seenTag);
                } else {
                    buf += text.charAt(i);
                }
            }
        } else if (state == IN_TAG_TYPE) {
            i += otag.length - 1;
            tag = Mustache.tags[text.charAt(i + 1)];
            tagType = tag ? text.charAt(i + 1) : '_v';
            if (tagType == '=') {
                i = changeDelimiters(text, i);
                state = IN_TEXT;
            } else {
                if (tag) {
                    i++;
                }
                state = IN_TAG;
            }
            seenTag = i;
        } else {
            if (tagChange(ctag, text, i)) {
                tokens.push({tag: tagType, n: trim(buf), otag: otag, ctag: ctag,
                    i: (tagType == '/') ? seenTag - otag.length : i + ctag.length});
                buf = '';
                i += ctag.length - 1;
                state = IN_TEXT;
                if (tagType == '{') {
                    if (ctag == '}}') {
                        i++;
                    } else {
                        cleanTripleStache(tokens[tokens.length - 1]);
                    }
                }
                if (-1 !== '# ^ _v { &'.indexOf(tagType)) {
                    Expression.parse(tokens[tokens.length - 1]);
                }
            } else {
                buf += text.charAt(i);
            }
        }
    }

    filterLine(seenTag, true);

    return tokens;
};

// the tags allowed inside super templates
var allowedInSuper = {'_t': true, '\n': true, '@': true, '/': true};

function isOpener(token, tags) {
    for (var i = 0, l = tags.length; i < l; i++) {
        if (tags[i].o == token.n) {
            token.tag = '#';
            return true;
        }
    }
}

function isCloser(close, open, tags) {
    for (var i = 0, l = tags.length; i < l; i++) {
        if (tags[i].c == close && tags[i].o == open) {
            return true;
        }
    }
}

function buildTree(tokens, kind, stack, customTags) {
    var instructions = [],
        opener = null,
        tail = null,
        token = null;

    tail = stack[stack.length - 1];

    while (tokens.length > 0) {
        token = tokens.shift();

        if (tail && tail.tag == '<' && !(token.tag in allowedInSuper)) {
            throw new Error('Illegal content in < super tag.');
        }

        if (Mustache.tags[token.tag] <= Mustache.tags['@'] || isOpener(token, customTags)) {
            stack.push(token);
            token.nodes = buildTree(tokens, token.tag, stack, customTags);
        } else if (token.tag == '/') {
            if (stack.length === 0) {
                throw new Error('Closing tag without opener: /' + token.n);
            }
            opener = stack.pop();
//        if (token.n != opener.n && !isCloser(token.n, opener.n, customTags)) {
//          throw new Error('Nesting error: ' + opener.n + ' vs. ' + token.n);
//        }
            opener.end = token.i;
            return instructions;
        } else if (token.tag == '\n') {
            token.last = (tokens.length == 0) || (tokens[0].tag == '\n');
        }

        instructions.push(token);
    }

    if (stack.length > 0) {
        throw new Error('missing closing tag: ' + stack.pop().n);
    }

    return instructions;
}

Mustache.parse = function (text, options) {
    options = options || {};
    return buildTree(scan(text, options.delimiters), '', [], options.sectionTags || []);
};
