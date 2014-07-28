# Horseshoe Template Engine
v0.0.2

## 1. 使用说明

```
var fs = require('fs');
var horseshoe = require('./');
var file = fs.readFileSync(__dirname + 'template.hjs', 'utf8');
var template = horseshoe.compile(file);

var ret = template.render({
    type: 'dog'
});
console.log(ret);
```

## 2. 本模板语法基于 [Mustache](http://mustache.github.io/mustache.5.html) ，并做了以下修改

### 2.1 增加模板继承语法（增加标签'<', '@'），使用案例：

```
{{% layout.hjs content }}

{{>header}}
{{@content}}Default Content.{{/content}}
```

```
{{% index.hjs content }}

{{<layout}}
{{@content}}Index Content.{{/content}}
{{/layout}}
```

### 2.2 增加数组Index、对象Key引用（标签末尾加 :i 或 :key），使用案例：

```
{{% 对应模板 }}

{{#list:i}}
    {{i}} : {{name)}}
{{/list}}

{{#object:key}}
    {{key}} : {{name}}
{{/object}}

对应数据：
{
    list: [
        {name: 'a', age: 3},
        {name: 'b', age: 4}
    ],
    object: {
        'foo': {name: 'foo'},
        'bar': {name: 'bar'}
    }
}

输出：

    0 : a
    1 : b

    foo : foo
    bar : bar
```

### 2.3 增加Expression语法，使用案例：

```
<div class='bar-chart'>
  {{#bars:i}}
    <div style='width: {{ value * 100 }}%;'>{{ i + 1 }}</div>
  {{/bars}}
</div>

Or it could mean formatting a currency so that 1.79 renders as £1.79p:
<p>Price: <strong>{{ format( price ) }}</strong></p>

Or it could mean adding a class based on some condition:
<a class='button {{ active ? "on" : "off" }}'>switch</a>

Or it could mean filtering a list to exclude certain records:
<ul>
{{# exclude( list, 'N/A' ) }}
  <li>{{author}}: {{title}}</li>
{{/ end of filter }}
</ul>
```

### 2.4 为避免与 Expression 冲突，修改注释标签 ! 为 %

### 2.5 Expression 已经够用了，移除了 Mustache 的 Lambda 支持