import jsep from 'jsep';

export const displayValue = value => value == null ? '' : Array.isArray(value) ? value.map(displayValue).join(', ') : typeof value === 'object' ? value.start || value.name || value.plain_text || JSON.stringify(value) : String(value);
export const isEmpty = value => value == null || value === '' || (Array.isArray(value) && !value.length) || (typeof value === 'object' && value !== null && 'start' in value && !value.start);
export function matches(values, filter) {
  if (!filter) return true;
  if (filter.filters) return filter.operator === 'or' ? filter.filters.some(f => matches(values, f)) : filter.filters.every(f => matches(values, f));
  const actual = values[filter.property], expected = filter.value;
  const a = displayValue(actual).toLocaleLowerCase(), b = displayValue(expected).toLocaleLowerCase();
  switch (filter.operator) {
    case 'is': return a === b;
    case 'is_not': return a !== b;
    case 'contains': return Array.isArray(actual) ? actual.some(v => displayValue(v).toLocaleLowerCase() === b || v?.id === expected) : a.includes(b);
    case 'not_contains': return !matches(values, { ...filter, operator: 'contains' });
    case 'empty': return isEmpty(actual);
    case 'not_empty': return !isEmpty(actual);
    case 'gt': return !isEmpty(actual) && !isEmpty(expected) && Number(actual) > Number(expected);
    case 'gte': return !isEmpty(actual) && !isEmpty(expected) && Number(actual) >= Number(expected);
    case 'lt': return !isEmpty(actual) && !isEmpty(expected) && Number(actual) < Number(expected);
    case 'lte': return !isEmpty(actual) && !isEmpty(expected) && Number(actual) <= Number(expected);
    case 'before': return Date.parse(a) < Date.parse(b);
    case 'after': return Date.parse(a) > Date.parse(b);
    case 'relative_date': {
      const date=Date.parse(a), start=new Date(), end=new Date();start.setHours(0,0,0,0);end.setHours(0,0,0,0);
      if(expected.value==='custom') { const days=Number(expected.count||1)*({day:1,week:7,month:30,year:365}[expected.unit]||1);if(expected.direction==='past')start.setDate(start.getDate()-days);else end.setDate(end.getDate()+days); }
      else if(expected.unit==='week'){start.setDate(start.getDate()-(start.getDay()+6)%7);end.setTime(start.getTime());end.setDate(end.getDate()+7);}
      else if(expected.unit==='month'){start.setDate(1);end.setMonth(end.getMonth()+1,1);}
      else if(expected.unit==='year'){start.setMonth(0,1);end.setFullYear(end.getFullYear()+1,0,1);}
      else end.setDate(end.getDate()+1);
      return date>=start.getTime()&&date<end.getTime();
    }
    default: throw new Error(`Unsupported condition: ${filter.operator}`);
  }
}
const astCache = new Map();
export function formula(expression, values) {
  if (!expression) throw new Error('Formula source is missing. Showing the exported value.');
  if (expression.length > 10000) throw new Error('Formula is too long.');
  let ast = astCache.get(expression);
  if (!ast) { ast = jsep(expression); if (astCache.size > 200) astCache.clear(); astCache.set(expression, ast); }
  const flattenNumbers = args => args.flat(Infinity).map(Number).filter(Number.isFinite);
  const dateUnits = { milliseconds: 1, seconds: 1000, minutes: 60000, hours: 3600000, days: 86400000, weeks: 604800000 };
  const functions = {
    prop: name => values[name] ?? null, empty: isEmpty, format: displayValue, toNumber: value => Number(value),
    abs: Math.abs, round: (value, places = 0) => Number(Number(value).toFixed(Math.max(0, Math.min(12, places)))), floor: Math.floor, ceil: Math.ceil,
    min: (...args) => Math.min(...flattenNumbers(args)), max: (...args) => Math.max(...flattenNumbers(args)), sum: (...args) => flattenNumbers(args).reduce((a, b) => a + b, 0),
    length: value => value?.length ?? 0, contains: (value, part) => Array.isArray(value) ? value.includes(part) : displayValue(value).includes(displayValue(part)),
    concat: (...args) => args.map(displayValue).join(''), join: (value, separator) => Array.isArray(value) ? value.join(separator) : displayValue(value),
    repeat: (value, times) => { const text=displayValue(value), count=Math.max(0,Math.trunc(Number(times)));if(!Number.isFinite(count)||text.length*count>100000)throw new Error('Formula text is too large.');return text.repeat(count); },
    lower: value => displayValue(value).toLocaleLowerCase(), upper: value => displayValue(value).toLocaleUpperCase(),
    substring: (value, start, end) => displayValue(value).slice(start, end), replaceAll: (value, from, to) => displayValue(value).split(displayValue(from)).join(displayValue(to)),
    not: value => !value, and: (...args) => args.every(Boolean), or: (...args) => args.some(Boolean),
    now: () => new Date().toISOString(), today: () => new Date().toISOString().slice(0, 10), parseDate: value => new Date(value).toISOString(),
    dateStart: value => value?.start || value || '', dateEnd: value => value?.end || value?.start || value || '',
    dateBetween: (a, b, unit) => { if (!dateUnits[unit]) throw new Error(`Unsupported date unit: ${unit}`); return Math.trunc((Date.parse(displayValue(a)) - Date.parse(displayValue(b))) / dateUnits[unit]); },
    dateAdd: (a, amount, unit) => { if(isEmpty(a))return null;const date=new Date(displayValue(a));if(unit==='months')date.setMonth(date.getMonth()+Number(amount));else if(unit==='years')date.setFullYear(date.getFullYear()+Number(amount));else {if(!dateUnits[unit])throw new Error(`Unsupported date unit: ${unit}`);date.setTime(date.getTime()+amount*dateUnits[unit]);}return date.toISOString(); },
  };
  let count = 0;
  const evaluate = node => {
    if (++count > 2000) throw new Error('Formula is too complex.');
    if (node.type === 'Literal') return node.value;
    if (node.type === 'Identifier') { if (node.name === 'true') return true; if (node.name === 'false') return false; if (node.name === 'null') return null; if (Object.hasOwn(values, node.name)) return values[node.name]; throw new Error(`Unknown property: ${node.name}`); }
    if (node.type === 'ArrayExpression') return node.elements.map(evaluate);
    if (node.type === 'ConditionalExpression') return evaluate(node.test) ? evaluate(node.consequent) : evaluate(node.alternate);
    if (node.type === 'UnaryExpression') { const value = evaluate(node.argument); if (node.operator === '!') return !value; if (node.operator === '-') return -Number(value); if (node.operator === '+') return Number(value); }
    if(node.type==='CallExpression'&&node.callee.type==='MemberExpression'&&!node.callee.computed){const name=node.callee.property.name;if(!Object.hasOwn(functions,name))throw new Error(`Unsupported function: ${name}`);return functions[name](evaluate(node.callee.object),...node.arguments.map(evaluate));}
    if (node.type === 'CallExpression' && node.callee.type === 'Identifier') {
      const name = node.callee.name;
      if (name === 'if') return evaluate(node.arguments[0]) ? evaluate(node.arguments[1]) : evaluate(node.arguments[2]);
      if (name === 'ifs') { for (let i = 0; i < node.arguments.length - 1; i += 2) if (evaluate(node.arguments[i])) return evaluate(node.arguments[i + 1]); return node.arguments.length % 2 ? evaluate(node.arguments.at(-1)) : null; }
      if (!Object.hasOwn(functions, name)) throw new Error(`Unsupported function: ${name}`);
      return functions[name](...node.arguments.map(evaluate));
    }
    if (node.type === 'BinaryExpression') {
      const a = evaluate(node.left);
      if (node.operator === '&&') return a && evaluate(node.right);
      if (node.operator === '||') return a || evaluate(node.right);
      const b = evaluate(node.right);
      switch (node.operator) { case '+': return typeof a === 'string' || typeof b === 'string' ? displayValue(a) + displayValue(b) : Number(a) + Number(b); case '-': return a - b; case '*': return a * b; case '/': if (!Number(b)) throw new Error('Division by zero'); return a / b; case '%': return a % b; case '**': return a ** b; case '==': case '===': return a === b; case '!=': case '!==': return a !== b; case '>': return a > b; case '<': return a < b; case '>=': return a >= b; case '<=': return a <= b; }
    }
    throw new Error('Unsupported formula expression.');
  };
  const result = evaluate(ast);
  if (typeof result === 'number' && !Number.isFinite(result)) throw new Error('Formula result is not finite.');
  return result;
}
export function computedRows(database, databases = []) {
  const all=new Map([...databases,database].map(db=>[db.id,db])), cache=new Map(), visiting=new Set();
  const compute=(db,row,property)=>{
    if(!property)throw new Error('Related property is unavailable.');
    const key=JSON.stringify([db.id,row.id,property.id]);
    if(cache.has(key)){const result=cache.get(key);if(result.error)throw result.error;return result.value;}
    if(visiting.has(key))throw new Error('Circular formula or rollup');visiting.add(key);
    try {
      let value=row.values[property.id];
      if(property.type==='formula'){
        const named=Object.create(null);
        for(const p of db.properties)Object.defineProperty(named,p.name,{enumerable:true,configurable:true,get:()=>compute(db,row,p)});
        value=formula(property.expression,named);
      }else if(property.type==='rollup'){
        const relation=db.properties.find(p=>p.id===property.relation), target=all.get(relation?.target);
        if(!relation||!target)throw new Error('Rollup relation is unavailable. Showing the exported value.');
        const selected=new Set(Array.isArray(row.values[relation.id])?row.values[relation.id]:[]), targetProperty=target.properties.find(p=>p.id===property.targetProperty);
        const records=target.rows.filter(r=>selected.has(r.id)||selected.has(r.pageId));
        const values=property.aggregation==='count'?records:records.map(r=>compute(target,r,targetProperty));
        const nums=values.filter(v=>!isEmpty(v)).map(Number).filter(Number.isFinite), sum=nums.reduce((a,b)=>a+b,0);
        switch(property.aggregation){case 'count':value=records.length;break;case 'sum':value=sum;break;case 'average':value=nums.length?sum/nums.length:null;break;case 'min':value=nums.length?Math.min(...nums):null;break;case 'max':value=nums.length?Math.max(...nums):null;break;case 'percent_checked':value=values.length?values.filter(v=>v===true).length/values.length:0;break;case 'count_per_group':case 'percent_per_group':{const count=values.filter(v=>(property.groupValues||[]).includes(v)).length;value=property.aggregation==='count_per_group'?count:values.length?count/values.length:0;break;}case 'show':value=values.flat();break;default:throw new Error('Rollup calculation is unavailable. Showing the exported value.');}
      }
      cache.set(key,{value});return value;
    }catch(error){cache.set(key,{error});throw error;}finally{visiting.delete(key);}
  };
  return database.rows.map(row=>{const values={...row.values},errors={};for(const property of database.properties)try{values[property.id]=compute(database,row,property);}catch(error){errors[property.id]=error.message;}return {...row,values,errors};});
}
export function queryRows(database, view, databases = []) {
  const rows = computedRows(database, databases).filter(row => matches(row.values, view?.filter));
  for (const sort of [...(view?.sorts || [])].reverse()) rows.sort((a,b) => {
    const av = a.values[sort.property], bv = b.values[sort.property];
    return (typeof av === 'number' && typeof bv === 'number' ? av - bv : displayValue(av).localeCompare(displayValue(bv), undefined, { numeric: true })) * (sort.direction === 'desc' ? -1 : 1);
  });
  return rows;
}
