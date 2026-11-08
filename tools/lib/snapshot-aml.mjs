// AML 組裝與 XmlElement → 資料列對應（純函式，可用罐頭 XML 測試）。
import { child, text, itemId, keyedName, i18nLabel, relationships } from './aras.mjs';

export const PAGE_SIZE = 200;

export const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** 一次取回 ItemType 與其 Property／RelationshipType／Server Event／Item Action／ItemType Life Cycle */
export function itemTypeAml(name) {
  return (
    `<AML><Item type="ItemType" action="get" language="zt" select="name,label">` +
    `<name>${esc(name)}</name><Relationships>` +
    `<Item type="Property" action="get" language="zt" select="name,label,data_type,data_source,is_required,sort_order"/>` +
    `<Item type="RelationshipType" action="get" select="name,related_id"/>` +
    `<Item type="Server Event" action="get" select="server_event,related_id,sort_order"/>` +
    `<Item type="Item Action" action="get" select="related_id"><related_id><Item type="Action" action="get" language="zt" select="name,label,method"/></related_id></Item>` +
    `<Item type="ItemType Life Cycle" action="get" select="related_id"/>` +
    `</Relationships></Item></AML>`
  );
}

export function lifecycleMapAml(id) {
  return (
    `<AML><Item type="Life Cycle Map" action="get" id="${esc(id)}" language="zt" select="name"><Relationships>` +
    `<Item type="Life Cycle State" action="get" language="zt" select="name,label,sort_order"/>` +
    `<Item type="Life Cycle Transition" action="get" select="from_state,to_state"/>` +
    `</Relationships></Item></AML>`
  );
}

export function methodPageAml(page, only) {
  const crit = only ? `<name>${esc(only)}</name>` : '';
  return (
    `<AML><Item type="Method" action="get" select="name,method_type,method_code,comments" ` +
    `orderBy="name" page="${page}" pagesize="${PAGE_SIZE}">${crit}</Item></AML>`
  );
}

/** item 屬性：展開成巢狀 Item 時取其 keyed_name 或 name，否則取 keyed_name 屬性 */
function refName(el, tag) {
  const prop = child(el, tag);
  if (!prop) return '';
  const nested = child(prop, 'Item');
  if (nested) return text(nested, 'name') || nested.getAttribute('keyed_name') || '';
  return prop.getAttribute('keyed_name') || '';
}

export function mapItemType(el) {
  const properties = relationships(el, 'Property').map((p) => ({
    name: text(p, 'name'),
    label: i18nLabel(p),
    dataType: text(p, 'data_type'),
    dataSource: refName(p, 'data_source') || keyedName(p, 'data_source'),
    required: text(p, 'is_required') === '1',
    sort: Number(text(p, 'sort_order')) || 0,
  }));
  properties.sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name));
  return {
    name: text(el, 'name'),
    label: i18nLabel(el),
    properties,
    relationshipTypes: relationships(el, 'RelationshipType').map((r) => ({
      name: text(r, 'name'),
      relatedItemType: refName(r, 'related_id'),
    })),
    serverEvents: relationships(el, 'Server Event')
      .map((e) => ({ event: text(e, 'server_event'), method: refName(e, 'related_id'), sort: Number(text(e, 'sort_order')) || 0 }))
      .sort((a, b) => a.event.localeCompare(b.event) || a.sort - b.sort)
      .map(({ event, method }) => ({ event, method })),
    actions: relationships(el, 'Item Action').map((a) => {
      const action = child(child(a, 'related_id') ?? a, 'Item');
      return {
        label: action ? i18nLabel(action) || text(action, 'name') : '',
        method: action ? refName(action, 'method') : '',
      };
    }),
    lifecycleMapIds: relationships(el, 'ItemType Life Cycle').map((l) => itemId(l, 'related_id')).filter(Boolean),
  };
}

export function mapLifecycleMap(el) {
  const states = relationships(el, 'Life Cycle State')
    .map((s) => ({ name: text(s, 'name'), label: i18nLabel(s), sort: Number(text(s, 'sort_order')) || 0 }))
    .sort((a, b) => a.sort - b.sort);
  const byId = new Map(relationships(el, 'Life Cycle State').map((s) => [s.getAttribute('id'), text(s, 'name')]));
  const stateName = (t, tag) => keyedName(t, tag) || byId.get(itemId(t, tag)) || itemId(t, tag);
  return {
    name: text(el, 'name'),
    states: states.map(({ name, label }) => ({ name, label })),
    transitions: relationships(el, 'Life Cycle Transition').map((t) => ({
      from: stateName(t, 'from_state'),
      to: stateName(t, 'to_state'),
    })),
  };
}

export function mapMethod(el) {
  return {
    id: el.getAttribute('id') ?? '',
    name: text(el, 'name'),
    methodType: text(el, 'method_type'),
    comments: text(el, 'comments'),
    code: text(el, 'method_code'),
  };
}
