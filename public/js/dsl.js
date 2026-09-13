// 条件 DSL —— 技术文档 §4.1
// 文法：expr := and ('|' and)* ; and := unit ('&' unit)*
//       unit := '!'? ( '(' expr ')' | EVT?[ids] | TLT?[ids] | NAME op NUMBER | NAME '=' bool )
// 示例："信任>=2 & EVT?[n5,n9]"、"TLT?[ic2] | 清醒>5"、"!flags.已和解"
// 属性名/旗标名支持中文。未定义属性按 0 处理并 console.warn（校验器负责在构建期拦截）。

const RE_TOKEN = /\s*(>=|<=|!=|==|=|>|<|\(|\)|&|\||!|EVT\?\[|TLT\?\[|[^\s()&|!<>=,?\[\]]+|,|\])/y;

function tokenize(input) {
  const tokens = [];
  let pos = 0;
  while (pos < input.length) {
    RE_TOKEN.lastIndex = pos;
    const m = RE_TOKEN.exec(input);
    if (!m || m[0].trim() === '' && pos === RE_TOKEN.lastIndex) throw new Error(`DSL 无法解析: "${input}" @${pos}`);
    pos = RE_TOKEN.lastIndex;
    const t = m[0].trim();
    if (t === '') continue;
    tokens.push(t);
  }
  return tokens;
}

export function createEvaluator(state, warn = () => {}) {
  const attrs = state.attrs || {};
  const evt = new Set(state.evt || []);
  const tlt = new Set(state.tlt || []);
  const flags = state.flags || {};
  const tokens = { list: null, i: 0 };
  let src = '';

  const peek = () => tokens.list[tokens.i];
  const next = () => tokens.list[tokens.i++];

  function parseExpr() {
    let v = parseAnd();
    while (peek() === '|') { next(); v = parseAnd() || v; }
    return v;
  }
  function parseAnd() {
    let v = parseUnit();
    while (peek() === '&') { next(); const r = parseUnit(); v = v && r; }
    return v;
  }
  function parseUnit() {
    if (peek() === '!') { next(); return !parseUnit(); }
    if (peek() === '(') { next(); const v = parseExpr(); if (next() !== ')') throw new Error(`DSL 括号不匹配: "${src}"`); return v; }
    return parseAtom();
  }
  function parseAtom() {
    const t = next();
    if (t === 'EVT?[' || t === 'TLT?[') {
      const set = t === 'EVT?[' ? evt : tlt;
      const ids = [];
      for (;;) {
        const id = next();
        if (id === undefined || id === ']') break;
        if (id !== ',') ids.push(id);
      }
      return ids.some((id) => set.has(id));
    }
    const op = peek();
    if (op === undefined || op === ')' || op === '&' || op === '|') {
      // 裸旗标名：存在即真
      if (t in flags) return Boolean(flags[t]);
      if (t in attrs) return attrs[t] > 0;
      warn(`DSL 引用了未定义的名称: ${t}`);
      return false;
    }
    next();
    const value = next();
    if (op === '=' || op === '==') {
      if (value === 'true') return Boolean(flags[t]) === true;
      if (value === 'false') return Boolean(flags[t]) === false;
      if (!(t in attrs)) { warn(`DSL 比较未定义属性: ${t}`); return false; }
      return attrs[t] === Number(value);
    }
    if (op === '!=') {
      if (value === 'true') return Boolean(flags[t]) !== true;
      if (value === 'false') return Boolean(flags[t]) !== false;
      if (!(t in attrs)) return true;
      return attrs[t] !== Number(value);
    }
    if (['>', '<', '>=', '<='].includes(op)) {
      if (!(t in attrs)) { warn(`DSL 比较未定义属性: ${t}`); return false; }
      const a = attrs[t], b = Number(value);
      if (Number.isNaN(b)) throw new Error(`DSL 数值无效: ${t}${op}${value}`);
      return op === '>' ? a > b : op === '<' ? a < b : op === '>=' ? a >= b : a <= b;
    }
    throw new Error(`DSL 未知运算符: ${op} in "${src}"`);
  }

  return function evaluate(expr) {
    if (expr == null || expr === '') return true;
    src = String(expr);
    tokens.list = tokenize(src);
    tokens.i = 0;
    const v = parseExpr();
    if (tokens.i < tokens.list.length) throw new Error(`DSL 存在多余符号: "${src}"`);
    return v;
  };
}

export function evalCondition(expr, state) {
  return createEvaluator(state)(expr);
}
