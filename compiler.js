var Expression = require('./parser/expression');
var Mustache = require('./parser/mustache');
var Horseshoe = exports;
Horseshoe.template = Horseshoe.Template;


// Setup regex  assignments
// remove whitespace according to Mustache spec
var rQuot = /\"/g,
    rNewline = /\n/g,
    rCr = /\r/g,
    rSlash = /\\/g;

function esc(s) {
    return s.replace(rSlash, '\\\\')
        .replace(rQuot, '\\\"')
        .replace(rNewline, '\\n')
        .replace(rCr, '\\r');
}

function chooseMethod(s) {
    return (~s.indexOf('.')) ? 'd' : 'f';
}

Expression.codegen = function (node, context) {
    var types = Expression.types;

    switch(node.t) {
        case types.NUMBER_LITERAL:
            context.code += node.v;
            break;
        case types.STRING_LITERAL:
            context.code += '"' + esc(node.v) + '"';
            break;
        case types.ARRAY_LITERAL:
            Expression.codegen(node.m, context);
            break;
        case types.OBJECT_LITERAL:
            Expression.codegen(node.m, context);
            break;
        case types.BOOLEAN_LITERAL:
            context.code += node.v;
            break;
        case types.GLOBAL:
            context.code += node.v;
            break;
        case types.KEY_VALUE_PAIR:
            context.code += node.k + ':';
            Expression.codegen(node.v, context);
            break;
        case types.REFERENCE:
            context.code += 't.' +
                chooseMethod(node.n) +
                '("' + node.n + '",c,p,0)';
            break;
        case types.REFINEMENT:
            if (node.n) {
                context.code += '.' + node.n;
            } else {
                context.code += '[';
                Expression.codegen(node.x, context);
                context.code += ']';
            }
            break;
        case types.MEMBER:
            Expression.codegen(node.x, context);
            Expression.codegen(node.r, context);
            break;
        case types.PREFIX_OPERATOR:
            context.code += node.s + ' ';
            Expression.codegen(node.o, context);
            break;
        case types.BRACKETED:
            context.code += '(';
            Expression.codegen(node.x, context);
            context.code += ')';
            break;
        case types.CONDITIONAL:
            Expression.codegen(node.o[0], context);
            context.code += '?';
            Expression.codegen(node.o[1], context);
            context.code += ':';
            Expression.codegen(node.o[2], context);
            break;
        case types.INFIX_OPERATOR:
            Expression.codegen(node.o[0], context);
            context.code += node.s;
            Expression.codegen(node.o[1], context);
            break;
        case types.INVOCATION:
            Expression.codegen(node.x, context);
            context.code += '(';
            if (node.o.length) {
                Expression.codegen(node.o[0], context);
            }
            for (var i = 1; i < node.o.length; i++) {
                context.code += ',';
                Expression.codegen(node.o[i], context);
            }
            context.code += ')';
            break;
    }
};
Expression.walk = function(node, context) {
    Expression.codegen(node.ast, context);
};

function createPartial(node, context) {
    var prefix = "<" + (context.prefix || "");
    var sym = prefix + node.n + serialNo++;
    context.partials[sym] = {name: node.n, partials: {}};
    context.code += 't.b(t.rp("' + esc(sym) + '",c,p,"' + (node.indent || '') + '"));';
    return sym;
}

function tripleStache(node, context) {
    context.code += 't.b(t.t(';
    Expression.walk(node, context);
    context.code += '));';
}

function write(s) {
    return 't.b(' + s + ');';
}

Mustache.codegen = {
    '#': function (node, context) {
        context.code += 'if(t.s(';
        Expression.walk(node, context);
        context.code += ',c,p,0,' + node.i + ',' + node.end + ',"' + node.otag + " " + node.ctag + '")){' +
            't.rs(c,p,' + 'function(c,p,t){';
        Mustache.walk(node.nodes, context);
        context.code += '}';
        if (node.ref) {
            context.code += ',"' + node.ref + '"';
        }
        context.code += ');c.pop();}';
    },

    '^': function (node, context) {
        context.code += 'if(!t.s(';
        Expression.walk(node, context);
        context.code += ',c,p,1,0,0,"")){';
        Mustache.walk(node.nodes, context);
        context.code += '};';
    },

    '>': createPartial,
    '<': function (node, context) {
        var ctx = {partials: {}, code: '', subs: {}, inPartial: true};
        Mustache.walk(node.nodes, ctx);
        var template = context.partials[createPartial(node, context)];
        template.subs = ctx.subs;
        template.partials = ctx.partials;
    },

    '@': function (node, context) {
        var ctx = {subs: {}, code: '', partials: context.partials, prefix: node.n};
        Mustache.walk(node.nodes, ctx);
        context.subs[node.n] = ctx.code;
        if (!context.inPartial) {
            context.code += 't.sub("' + esc(node.n) + '",c,p,i);';
        }
    },

    '\n': function (node, context) {
        context.code += write('"\\n"' + (node.last ? '' : ' + i'));
    },

    '_v': function (node, context) {
        context.code += 't.b(t.v(';
        Expression.walk(node, context);
        context.code += '));';
    },

    '_t': function (node, context) {
        context.code += write('"' + esc(node.text) + '"');
    },

    '{': tripleStache,

    '&': tripleStache
};
Mustache.walk = function (nodelist, context) {
    var func;
    for (var i = 0, l = nodelist.length; i < l; i++) {
        func = Mustache.codegen[nodelist[i].tag];
        func && func(nodelist[i], context);
    }
    return context;
};


function wrapMain(code) {
    return 'var t=this;t.b(i=i||"");' + code + 'return t.fl();';
}

function makePartials(codeObj) {
    var key, template = {subs: {}, partials: codeObj.partials, name: codeObj.name};
    for (key in template.partials) {
        template.partials[key] = makePartials(template.partials[key]);
    }
    for (key in codeObj.subs) {
        template.subs[key] = new Function('c', 'p', 't', 'i', codeObj.subs[key]);
    }
    return template;
}

function makeTemplate(codeObj, text, options) {
    var template = makePartials(codeObj);
    template.code = new Function('c', 'p', 'i', wrapMain(codeObj.code));
    return new Horseshoe.template(template, text, Horseshoe, options);
}

function stringifySubstitutions(obj) {
    var items = [];
    for (var key in obj) {
        items.push('"' + esc(key) + '": function(c,p,t,i) {' + obj[key] + '}');
    }
    return "{ " + items.join(",") + " }";
}

function stringifyPartials(codeObj) {
    var partials = [];
    for (var key in codeObj.partials) {
        partials.push('"' + esc(key) + '":{name:"' + esc(codeObj.partials[key].name) + '", ' + stringifyPartials(codeObj.partials[key]) + "}");
    }
    return "partials: {" + partials.join(",") + "}, subs: " + stringifySubstitutions(codeObj.subs);
}

function stringify(codeObj, text, options) {
    return "{code: function (c,p,i) { " + wrapMain(codeObj.code) + " }," + stringifyPartials(codeObj) + "}";
}

var serialNo = 0;
function generate(tree, text, options) {
    serialNo = 0;
    var context = { code: '', subs: {}, partials: {} };
    Mustache.walk(tree, context);

    if (options.asString) {
        return stringify(context, text, options);
    }

    return makeTemplate(context, text, options);
}


Horseshoe.cache = {};

Horseshoe.cacheKey = function (text, options) {
    return [text, !!options.asString, options.delimiters, !!options.modelGet].join('||');
};

Horseshoe.compile = function (text, options) {
    options = options || {};
    var key = Horseshoe.cacheKey(text, options);
    var template = this.cache[key];

    if (template) {
        var partials = template.partials;
        for (var name in partials) {
            delete partials[name].instance;
        }
        return template;
    }

    template = generate(Mustache.parse(text, options), text, options);
    return this.cache[key] = template;
};
