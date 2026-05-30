// Minimal React shim for artifact sandbox JSX rendering
// Supports createElement, Fragment, and createRoot for simple component preview
(function(global) {
  function createElement(type, props, ...children) {
    if (typeof type === 'function') {
      return type({ ...props, children: children.length === 1 ? children[0] : children });
    }
    const el = type === Fragment
      ? document.createDocumentFragment()
      : document.createElement(type);
    if (props && el instanceof HTMLElement) {
      for (const [key, val] of Object.entries(props)) {
        if (key === 'className') el.setAttribute('class', val);
        else if (key === 'htmlFor') el.setAttribute('for', val);
        else if (key === 'dangerouslySetInnerHTML') el.innerHTML = val.__html;
        else if (key.startsWith('on') && typeof val === 'function') {
          el.addEventListener(key.slice(2).toLowerCase(), val);
        } else if (key === 'style' && typeof val === 'object') {
          Object.assign(el.style, val);
        } else if (typeof val === 'string' || typeof val === 'number') {
          el.setAttribute(key, String(val));
        } else if (typeof val === 'boolean' && val) {
          el.setAttribute(key, '');
        }
      }
    }
    for (const child of children.flat(Infinity)) {
      if (child == null || typeof child === 'boolean') continue;
      el.appendChild(
        child instanceof Node ? child : document.createTextNode(String(child))
      );
    }
    return el;
  }

  function Fragment() { return document.createDocumentFragment(); }

  function createRoot(container) {
    return {
      render(element) {
        container.innerHTML = '';
        if (element instanceof Node) container.appendChild(element);
      }
    };
  }

  global.React = { createElement, Fragment };
  global.ReactDOM = { createRoot };
})(window);
