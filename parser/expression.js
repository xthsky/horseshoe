var Expression = exports;

var leadingWhitespace = /^\s+/;
var types = {
    NUMBER_LITERAL    : 20,
    STRING_LITERAL    : 21,
    ARRAY_LITERAL     : 22,
    OBJECT_LITERAL    : 23,
    BOOLEAN_LITERAL   : 24,

    GLOBAL            : 26,
    KEY_VALUE_PAIR    : 27,

    REFERENCE         : 30,
    REFINEMENT        : 31,
    MEMBER            : 32,
    PREFIX_OPERATOR   : 33,
    BRACKETED         : 34,
    CONDITIONAL       : 35,
    INFIX_OPERATOR    : 36,

    INVOCATION        : 40
};


function expected(tokenizer, thing) {
    // from http://stackoverflow.com/a/4431347/100374
    function getClosestLowIndex(a, x) {
        var lo = -1;
        var hi = a.length;
        while (hi - lo > 1) {
            var mid = 0|((lo + hi)/2);
            if (a[mid] <= x) {
                lo = mid;
            } else {
                hi = mid;
            }
        }
        return lo;
    }
    function getLinePos() {
        var pos = tokenizer.pos;

        var lines = tokenizer.lines;
        var str = tokenizer.str;
        var line = getClosestLowIndex(lines, pos);
        var lineStart = lines[line];

        return {
            line: line + 1,
            ch: pos - lineStart + 1,
            getLine: function () {
                return str.slice(lineStart, lines[line + 1] - 1);
            },
            toString: function () {
                var line = this.getLine();
                return this.line + ":" + this.ch + ":\n" +
                    line + "\n" +
                    line.substr(0, this.ch - 1).replace(/[\S]/g, ' ') + "^----";
            }
        };
    }

    var remaining = tokenizer.str.slice(tokenizer.pos, tokenizer.pos + 40);
    if ( remaining.length === 40 ) {
        remaining += '...';
    }
    throw new Error( 'Tokenizer failed: unexpected string "' + remaining + '" (expected ' + thing + ') on line ' + getLinePos() );
}
function allowWhitespace(tokenizer) {
    var match = leadingWhitespace.exec( tokenizer.str.slice(tokenizer.pos) );

    if ( !match ) {
        return null;
    }

    tokenizer.pos += match[0].length;
    return match[0];
}
function makeRegexMatcher( regex ) {
    return function ( tokenizer ) {
        var match = regex.exec( tokenizer.str.slice( tokenizer.pos ) );

        if ( !match ) {
            return null;
        }

        tokenizer.pos += match[0].length;
        return match[1] || match[0];
    };
}
// Helper for defining getDoubleQuotedString and getSingleQuotedString.
function makeQuotedStringMatcher( okQuote ) {
    // Match one or more characters until: ", ', \, or EOL/EOF.
    // EOL/EOF is written as (?!.) (meaning there's no non-newline char next).
    var getStringMiddle = makeRegexMatcher( /^(?=.)[^"'\\]+?(?:(?!.)|(?=["'\\]))/ );
    // Match one escape sequence, including the backslash.
    var getEscapeSequence = makeRegexMatcher( /^\\(?:['"\\bfnrt]|0(?![0-9])|x[0-9a-fA-F]{2}|u[0-9a-fA-F]{4}|(?=.)[^ux0-9])/ );
    // Match one ES5 line continuation (backslash + line terminator).
    var getLineContinuation = makeRegexMatcher( /^\\(?:\r\n|[\u000A\u000D\u2028\u2029])/ );

    return function ( tokenizer ) {
        var start, literal, done, next;

        start = tokenizer.pos;
        literal = '"';
        done = false;

        while ( !done ) {
            next = ( getStringMiddle( tokenizer ) || getEscapeSequence( tokenizer ) ||
                getStringMatch(tokenizer, okQuote) );
            if ( next ) {
                if ( next === '"' ) {
                    literal += '\\"';
                } else if ( next === "\\'" ) {
                    literal += "'";
                } else {
                    literal += next;
                }
            } else {
                next = getLineContinuation( tokenizer );
                if ( next ) {
                    // convert \(newline-like) into a \u escape, which is allowed in JSON
                    literal += '\\u' + ( '000' + next.charCodeAt(1).toString(16) ).slice( -4 );
                } else {
                    done = true;
                }
            }
        }

        literal += '"';

        // use JSON.parse to interpret escapes
        return JSON.parse( literal );
    };
}
function getStringMatch(tokenizer, string) {
    var substr = tokenizer.str.slice( tokenizer.pos, tokenizer.pos + string.length );

    if ( substr === string ) {
        tokenizer.pos += string.length;
        return string;
    }

    return null;
}
var getName = makeRegexMatcher( /^[a-zA-Z_$][a-zA-Z_$0-9]*/ );
// http://mathiasbynens.be/notes/javascript-properties
// can be any name, string literal, or number literal
function getKey(tokenizer){
    var identifier = /^[a-zA-Z_$][a-zA-Z_$0-9]*$/;

    var token;

    if ( token = getStringLiteral( tokenizer ) ) {
        return identifier.test( token.v ) ? token.v : '"' + token.v.replace( /"/g, '\\"' ) + '"';
    }

    if ( token = getNumberLiteral( tokenizer ) ) {
        return token.v;
    }

    if ( token = getName( tokenizer ) ) {
        return token;
    }
}
function getRefinement(tokenizer){
    var start, name, expr;

    start = tokenizer.pos;

    allowWhitespace(tokenizer);

    // "." name
    if ( getStringMatch(tokenizer, '.') ) {
        allowWhitespace(tokenizer);

        if ( name = getName( tokenizer ) ) {
            return {
                t: types.REFINEMENT,
                n: name
            };
        }

        expected(tokenizer, 'a property name');
    }

    // "[" expression "]"
    if ( getStringMatch(tokenizer, '[') ) {
        allowWhitespace(tokenizer);

        expr = getExpression(tokenizer);
        if ( !expr ) {
            expected(tokenizer, 'an expression');
        }

        allowWhitespace(tokenizer);

        if ( !getStringMatch(tokenizer, ']') ) {
            expected(tokenizer, '"]"');
        }

        return {
            t: types.REFINEMENT,
            x: expr
        };
    }

    return null;
}
function getExpressionList(tokenizer){
    var start, expressions, expr, next;

    start = tokenizer.pos;

    allowWhitespace(tokenizer);

    expr = getExpression(tokenizer);

    if ( expr === null ) {
        return null;
    }

    expressions = [ expr ];

    // allow whitespace between expression and ','
    allowWhitespace(tokenizer);

    if ( getStringMatch(tokenizer, ',') ) {
        next = getExpressionList( tokenizer );
        if ( next === null ) {
            tokenizer.pos = start;
            return null;
        }

        expressions = expressions.concat( next );
    }

    return expressions;
}


var getDoubleQuotedString = makeQuotedStringMatcher( "'" );
var getSingleQuotedString = makeQuotedStringMatcher( '"' );
function getStringLiteral(tokenizer){
    var start, string;

    start = tokenizer.pos;

    if ( getStringMatch(tokenizer, '"') ) {
        string = getDoubleQuotedString( tokenizer );

        if ( !getStringMatch(tokenizer, '"') ) {
            tokenizer.pos = start;
            return null;
        }

        return {
            t: types.STRING_LITERAL,
            v: string
        };
    }

    if ( getStringMatch(tokenizer, "'") ) {
        string = getSingleQuotedString( tokenizer );

        if ( !getStringMatch(tokenizer, "'") ) {
            tokenizer.pos = start;
            return null;
        }

        return {
            t: types.STRING_LITERAL,
            v: string
        };
    }

    return null;
}
function getKeyValuePair(tokenizer){
    var start, key, value;

    start = tokenizer.pos;

    // allow whitespace between '{' and key
    allowWhitespace(tokenizer);

    key = getKey( tokenizer );
    if ( key === null ) {
        tokenizer.pos = start;
        return null;
    }

    // allow whitespace between key and ':'
    allowWhitespace(tokenizer);

    // next character must be ':'
    if ( !getStringMatch(tokenizer, ':') ) {
        tokenizer.pos = start;
        return null;
    }

    // allow whitespace between ':' and value
    allowWhitespace(tokenizer);

    // next expression must be a, well... expression
    value = getExpression(tokenizer);
    if ( value === null ) {
        tokenizer.pos = start;
        return null;
    }

    return {
        t: types.KEY_VALUE_PAIR,
        k: key,
        v: value
    };
}
function getKeyValuePairs(tokenizer){
    var start, pairs, pair, keyValuePairs;

    start = tokenizer.pos;

    pair = getKeyValuePair( tokenizer );
    if ( pair === null ) {
        return null;
    }

    pairs = [ pair ];

    if ( getStringMatch(tokenizer, ',' ) ) {
        keyValuePairs = getKeyValuePairs( tokenizer );

        if ( !keyValuePairs ) {
            tokenizer.pos = start;
            return null;
        }

        return pairs.concat( keyValuePairs );
    }

    return pairs;
}
function getObjectLiteral(tokenizer){
    var start, keyValuePairs;

    start = tokenizer.pos;

    // allow whitespace
    allowWhitespace(tokenizer);

    if ( !getStringMatch(tokenizer, '{') ) {
        tokenizer.pos = start;
        return null;
    }

    keyValuePairs = getKeyValuePairs( tokenizer );

    // allow whitespace between final value and '}'
    allowWhitespace(tokenizer);

    if ( !getStringMatch(tokenizer, '}') ) {
        tokenizer.pos = start;
        return null;
    }

    return {
        t: types.OBJECT_LITERAL,
        m: keyValuePairs
    };
}
function getArrayLiteral(tokenizer){
    var start, expressionList;

    start = tokenizer.pos;

    // allow whitespace before '['
    allowWhitespace(tokenizer);

    if ( !getStringMatch(tokenizer, '[') ) {
        tokenizer.pos = start;
        return null;
    }

    expressionList = getExpressionList( tokenizer );

    if ( !getStringMatch(tokenizer, ']') ) {
        tokenizer.pos = start;
        return null;
    }

    return {
        t: types.ARRAY_LITERAL,
        m: expressionList
    };
}
function getBooleanLiteral(tokenizer){
    if ( tokenizer.str.slice(tokenizer.pos, tokenizer.pos + 4) === 'true' ) {
        tokenizer.pos += 4;
        return {
            t: types.BOOLEAN_LITERAL,
            v: 'true'
        };
    }

    if ( tokenizer.str.slice(tokenizer.pos, tokenizer.pos + 5) === 'false' ) {
        tokenizer.pos += 5;
        return {
            t: types.BOOLEAN_LITERAL,
            v: 'false'
        };
    }

    return null;
}
function getNumberLiteral(tokenizer){
    // bulletproof number regex from https://gist.github.com/Rich-Harris/7544330
    var getNumber = makeRegexMatcher( /^(?:[+-]?)(?:(?:(?:0|[1-9]\d*)?\.\d+)|(?:(?:0|[1-9]\d*)\.)|(?:0|[1-9]\d*))(?:[eE][+-]?\d+)?/ );

    var result;

    if ( result = getNumber( tokenizer ) ) {
        return {
            t: types.NUMBER_LITERAL,
            v: result
        };
    }

    return null;
}
function getLiteral(tokenizer){
    var literal = getNumberLiteral( tokenizer )   ||
        getBooleanLiteral( tokenizer )  ||
        getStringLiteral( tokenizer )   ||
        getObjectLiteral( tokenizer )   ||
        getArrayLiteral( tokenizer );

    return literal;
}
var getReference = (function(){
    var getDotRefinement, getArrayRefinement, getArrayMember, globals;

    getDotRefinement = makeRegexMatcher( /^\.[a-zA-Z_$0-9]+/ );

    getArrayRefinement = function ( tokenizer ) {
        var num = getArrayMember( tokenizer );

        if ( num ) {
            return '.' + num;
        }

        return null;
    };

    getArrayMember = makeRegexMatcher( /^\[(0|[1-9][0-9]*)\]/ );

    // if a reference is a browser global, we don't deference it later, so it needs special treatment
    globals = /^(?:Array|Date|RegExp|decodeURIComponent|decodeURI|encodeURIComponent|encodeURI|isFinite|isNaN|parseFloat|parseInt|JSON|Math|NaN|undefined|null)$/;


    return function ( tokenizer ) {
        var startPos, ancestor, name, dot, combo, refinement, lastDotIndex;

        startPos = tokenizer.pos;

        // we might have ancestor refs...
        ancestor = '';
        while ( getStringMatch(tokenizer, '../') ) {
            ancestor += '../';
        }

        if ( !ancestor ) {
            // we might have an implicit iterator or a restricted reference
            dot = getStringMatch(tokenizer, '.') || '';
        }

        name = getName( tokenizer ) || '';

        // if this is a browser global, stop here
        if ( !ancestor && !dot && globals.test( name ) ) {
            return {
                t: types.GLOBAL,
                v: name
            };
        }

        // allow the use of `this`
        if ( name === 'this' && !ancestor && !dot ) {
            name = '.';
            startPos += 3; // horrible hack to allow method invocations with `this` by ensuring combo.length is right!
        }

        combo = ( ancestor || dot ) + name;

        if ( !combo ) {
            return null;
        }

        while ( refinement = getDotRefinement( tokenizer ) || getArrayRefinement( tokenizer ) ) {
            combo += refinement;
        }

        if ( getStringMatch(tokenizer, '(') ) {

            // if this is a method invocation (as opposed to a function) we need
            // to strip the method name from the reference combo, else the context
            // will be wrong
            lastDotIndex = combo.lastIndexOf( '.' );
            if ( lastDotIndex !== -1 ) {
                combo = combo.substr( 0, lastDotIndex );
                tokenizer.pos = startPos + combo.length;
            } else {
                tokenizer.pos -= 1;
            }
        }

        return {
            t: types.REFERENCE,
            n: combo
        };
    };
})();
function getBracketedExpression(tokenizer){
    var start, expr;

    start = tokenizer.pos;

    if ( !getStringMatch(tokenizer, '(') ) {
        return null;
    }

    allowWhitespace(tokenizer);

    expr = getExpression(tokenizer);
    if ( !expr ) {
        tokenizer.pos = start;
        return null;
    }

    allowWhitespace(tokenizer);

    if ( !getStringMatch(tokenizer, ')') ) {
        tokenizer.pos = start;
        return null;
    }

    return {
        t: types.BRACKETED,
        x: expr
    };
}
function getPrimary(tokenizer){
    return getLiteral( tokenizer )
        || getReference( tokenizer )
        || getBracketedExpression( tokenizer );
}
function getMemberOrInvocation(tokenizer) {
    var current, expression, refinement, expressionList;

    expression = getPrimary( tokenizer );

    if ( !expression ) {
        return null;
    }

    while ( expression ) {
        current = tokenizer.pos;

        if ( refinement = getRefinement( tokenizer ) ) {
            expression = {
                t: types.MEMBER,
                x: expression,
                r: refinement
            };
        }
        else if ( getStringMatch(tokenizer, '(') ) {
            allowWhitespace(tokenizer);

            expressionList = getExpressionList( tokenizer );

            allowWhitespace(tokenizer);

            if ( !getStringMatch(tokenizer, ')') ) {
                tokenizer.pos = current;
                break;
            }

            expression = {
                t: types.INVOCATION,
                x: expression
            };

            if ( expressionList ) {
                expression.o = expressionList;
            }
        }
        else {
            break;
        }
    }

    return expression;
}
var getTypeOf = (function() {
    function makePrefixSequenceMatcher( symbol, fallthrough ) {
        return function ( tokenizer ) {
            var start, expression;

            if ( !getStringMatch(tokenizer, symbol ) ) {
                return fallthrough( tokenizer );
            }

            start = tokenizer.pos;

            allowWhitespace(tokenizer);

            expression = getExpression(tokenizer);
            if ( !expression ) {
                expected(tokenizer, 'an expression');
            }

            return {
                s: symbol,
                o: expression,
                t: types.PREFIX_OPERATOR
            };
        };
    }

    // create all prefix sequence matchers, return getTypeOf
    return (function () {
        var i, len, matcher, prefixOperators, fallthrough;

        prefixOperators = '! ~ + - typeof'.split( ' ' );

        fallthrough = getMemberOrInvocation;
        for ( i=0, len=prefixOperators.length; i<len; i+=1 ) {
            matcher = makePrefixSequenceMatcher( prefixOperators[i], fallthrough );
            fallthrough = matcher;
        }

        // typeof operator is higher precedence than multiplication, so provides the
        // fallthrough for the multiplication sequence matcher we're about to create
        // (we're skipping void and delete)
        return fallthrough;
    })();
})();
var getLogicalOr = (function() {
    function makeInfixSequenceMatcher( symbol, fallthrough ) {
        return function ( tokenizer ) {
            var start, left, right;

            left = fallthrough( tokenizer );
            if ( !left ) {
                return null;
            }

            // Loop to handle left-recursion in a case like `a * b * c` and produce
            // left association, i.e. `(a * b) * c`.  The matcher can't call itself
            // to parse `left` because that would be infinite regress.
            while (true) {
                start = tokenizer.pos;

                allowWhitespace(tokenizer);

                if ( !getStringMatch(tokenizer, symbol) ) {
                    tokenizer.pos = start;
                    return left;
                }

                // special case - in operator must not be followed by [a-zA-Z_$0-9]
                if ( symbol === 'in' && /[a-zA-Z_$0-9]/.test( tokenizer.str.charAt( tokenizer.pos ) ) ) {
                    tokenizer.pos = start;
                    return left;
                }

                allowWhitespace(tokenizer);

                // right operand must also consist of only higher-precedence operators
                right = fallthrough( tokenizer );
                if ( !right ) {
                    tokenizer.pos = start;
                    return left;
                }

                left = {
                    t: types.INFIX_OPERATOR,
                    s: symbol,
                    o: [ left, right ]
                };

                // Loop back around.  If we don't see another occurrence of the symbol,
                // we'll return left.
            }
        };
    }

    // create all infix sequence matchers, and return getLogicalOr
    return (function () {
        var i, len, matcher, infixOperators, fallthrough;

        // All the infix operators on order of precedence (source: https://developer.mozilla.org/en-US/docs/JavaScript/Reference/Operators/Operator_Precedence)
        // Each sequence matcher will initially fall through to its higher precedence
        // neighbour, and only attempt to match if one of the higher precedence operators
        // (or, ultimately, a literal, reference, or bracketed expression) already matched
        infixOperators = '* / % + - << >> >>> < <= > >= in instanceof == != === !== & ^ | && ||'.split( ' ' );

        // A typeof operator is higher precedence than multiplication
        fallthrough = getTypeOf;
        for ( i=0, len=infixOperators.length; i<len; i+=1 ) {
            matcher = makeInfixSequenceMatcher( infixOperators[i], fallthrough );
            fallthrough = matcher;
        }

        // Logical OR is the fallthrough for the conditional matcher
        return fallthrough;
    })();
})();
function getConditional(tokenizer) {
    var start, expression, ifTrue, ifFalse;

    expression = getLogicalOr( tokenizer );
    if ( !expression ) {
        return null;
    }

    start = tokenizer.pos;

    allowWhitespace(tokenizer);

    if ( !getStringMatch(tokenizer, '?') ) {
        tokenizer.pos = start;
        return expression;
    }

    allowWhitespace(tokenizer);

    ifTrue = getExpression(tokenizer);
    if ( !ifTrue ) {
        tokenizer.pos = start;
        return expression;
    }

    allowWhitespace(tokenizer);

    if ( !getStringMatch(tokenizer, ':') ) {
        tokenizer.pos = start;
        return expression;
    }

    allowWhitespace(tokenizer);

    ifFalse = getExpression(tokenizer);
    if ( !ifFalse ) {
        tokenizer.pos = start;
        return expression;
    }

    return {
        t: types.CONDITIONAL,
        o: [ expression, ifTrue, ifFalse ]
    };
}
function getExpression(tokenizer) {
    return getConditional(tokenizer);
}

Expression.types = types;
Expression.parse = function(tag) {
    var text = tag.n;
    var tokenizer = {
        str: text,
        lines: [0],
        pos: 0
    };
    var index = 0;
    while ((index = text.indexOf('\n', index)) >= 0) {
        index++;
        tokenizer.lines.push(index);
    }
    tokenizer.lines.push(text.length + 1);

    var ast = getConditional(tokenizer);
    var i = tokenizer.pos;

    var ref = text.slice(i).match(/^(?:\s*:\s*(\w+))?\s*$/);
    if (!ref) expected(tokenizer, 'expression:keyRef');

    tag.n = text.slice(0, i);
    tag.ast = ast;
    if (ref[1]) {
        tag.ref = ref[1];
    }
};
