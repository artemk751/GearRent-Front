"use strict";

const API_BASE_URL = "http://127.0.0.1:8000/api/v1";

const KEYS = {
  access: "gearrent_access",
  refresh: "gearrent_refresh",
  user: "gearrent_user",
};
const FIELD_LIMITS = {
  username: 30,
  first_name: 30,
  last_name: 30,
  email: 254,
  password: 128,
};
const PASSWORD_MIN = 8;

const store = {
  get access() {
    return localStorage.getItem(KEYS.access);
  },
  get refresh() {
    return localStorage.getItem(KEYS.refresh);
  },
  get user() {
    try {
      return JSON.parse(localStorage.getItem(KEYS.user));
    } catch {
      return null;
    }
  },
  save({ access, refresh, user }) {
    if (access) localStorage.setItem(KEYS.access, access);
    if (refresh) localStorage.setItem(KEYS.refresh, refresh);
    if (user) localStorage.setItem(KEYS.user, JSON.stringify(user));
  },
  clear() {
    Object.values(KEYS).forEach((key) => localStorage.removeItem(key));
  },
};

const isLoggedIn = () => Boolean(store.refresh);
const isAdmin = () => Boolean(store.user && store.user.is_staff);

class ApiError extends Error {
  constructor(status, data, message) {
    super(message || errorInfo(data, status).general || `Помилка (${status})`);
    this.status = status;
    this.data = data;
  }
}

function toList(value) {
  if (value == null) return [];
  if (Array.isArray(value)) return value.flatMap(toList);
  if (typeof value === "object") return Object.values(value).flatMap(toList);
  return [String(value)];
}

function errorInfo(data, status) {
  const info = { fields: {}, general: "" };
  if (!data || typeof data !== "object") {
    if (status) info.general = `Помилка сервера (${status}).`;
    return info;
  }
  if (typeof data.error === "string") info.general = data.error;
  const body = data.error && typeof data.error === "object" ? data.error : data;

  const addFields = (obj) => {
    for (const [key, value] of Object.entries(obj)) {
      const messages = toList(value);
      if (!messages.length) continue;
      if (key === "non_field_errors") {
        info.general = info.general || messages.join(" ");
      } else {
        info.fields[key] = messages;
      }
    }
  };

  const nested = body.details || body.errors || body.fields;
  if (nested && typeof nested === "object") {
    addFields(nested);
  } else {
    const rest = {};
    for (const [key, value] of Object.entries(body)) {
      if (!["code", "message", "detail", "status", "status_code"].includes(key)) {
        rest[key] = value;
      }
    }
    addFields(rest);
  }
  if (typeof body.message === "string") info.general = info.general || body.message;
  if (typeof body.detail === "string") info.general = info.general || body.detail;
  return info;
}

function buildUrl(path, params) {
  const url = new URL(API_BASE_URL + path);
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value) url.searchParams.set(key, value);
  });
  return url;
}

async function rawFetch(path, { method = "GET", body, token, params } = {}) {
  const headers = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (token) headers["Authorization"] = `Bearer ${token}`;

  let response;
  try {
    response = await fetch(buildUrl(path, params), {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(
      0,
      null,
      "Не вдалося з'єднатися із сервером. Перевірте, чи запущено бекенд на " +
        API_BASE_URL
    );
  }

  let data = null;
  const text = await response.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }
  if (!response.ok) throw new ApiError(response.status, data);
  return data;
}

let refreshPromise = null;
function refreshAccess() {
  if (!store.refresh) {
    return Promise.reject(new ApiError(401, null, "Немає refresh-токена."));
  }
  if (!refreshPromise) {
    refreshPromise = rawFetch("/auth/refresh", {
      method: "POST",
      body: { refresh: store.refresh },
    })
      .then((data) => {
      
        store.save({ access: data.access, refresh: data.refresh });
        return data.access;
      })
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

async function authFetch(path, options = {}) {
  try {
    return await rawFetch(path, { ...options, token: store.access });
  } catch (error) {
    if (error.status !== 401) throw error;
    try {
      const newAccess = await refreshAccess();
      return await rawFetch(path, { ...options, token: newAccess });
    } catch (error2) {
      if (error2.status === 401) sessionExpired();
      throw error2;
    }
  }
}

const navEl = document.getElementById("navbar");
const appEl = document.getElementById("app");

const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
  );

let flash = null;
function setFlash(type, text) {
  flash = { type, text };
}
function takeFlash() {
  if (!flash) return "";
  const html = `<div class="alert ${flash.type}">${esc(flash.text)}</div>`;
  flash = null;
  return html;
}

const displayName = (user) => (user && (user.first_name || user.username)) || "";

function clearFormErrors(form) {
  form.querySelectorAll(".field-error").forEach((el) => (el.textContent = ""));
  form.querySelectorAll(".invalid").forEach((el) => el.classList.remove("invalid"));
  const general = form.querySelector(".form-error");
  if (general) general.textContent = "";
}

function showFormErrors(form, info) {
  const general = [];
  if (info.general) general.push(info.general);
  for (const [name, messages] of Object.entries(info.fields)) {
    const slot = form.querySelector(`[data-error-for="${name}"]`);
    if (slot) {
      slot.textContent = messages.join(" ");
      const input = form.elements[name];
      if (input) input.classList.add("invalid");
    } else {
      general.push(`${name}: ${messages.join(" ")}`);
    }
  }
  const generalEl = form.querySelector(".form-error");
  if (generalEl) generalEl.textContent = general.join(" ");
}

function errorToInfo(error) {
  const info = errorInfo(error.data, error.status);
  if (!info.general && !Object.keys(info.fields).length) info.general = error.message;
  return info;
}

function field(name, label, { type = "text", optional = false, autocomplete = "off" } = {}) {
  const max = FIELD_LIMITS[name] ? ` maxlength="${FIELD_LIMITS[name]}"` : "";
  const hint = optional ? ' <span class="opt">(необов\'язково)</span>' : "";
  return `
    <label for="${name}">${label}${hint}</label>
    <input id="${name}" name="${name}" type="${type}" autocomplete="${autocomplete}"${max}>
    <small class="field-error" data-error-for="${name}"></small>`;
}

function fillSelect(select, items) {
  items.forEach((item) => {
    const option = document.createElement("option");
    option.value = item.id;
    option.textContent = item.name;
    select.appendChild(option);
  });
}

const routes = {
  "/": { render: viewCatalog },
  "/login": { render: viewLogin, guestOnly: true },
  "/register": { render: viewRegister, guestOnly: true },
  "/profile": { render: viewProfile, auth: true },
  "/products/new": { render: viewProductForm, auth: true },
  "/users": { render: viewUsers, auth: true },
};

function parseHash() {
  const raw = location.hash.slice(1) || "/";
  const [path, query = ""] = raw.split("?");
  return { path, params: new URLSearchParams(query) };
}

function go(path, { replace = false } = {}) {
  const target = "#" + path;
  if (location.hash === target || (!location.hash && path === "/")) {
    router();
    return;
  }
  if (replace) location.replace(target);
  else location.hash = target;
}

function goLogin(nextPath) {
  const skip = !nextPath || nextPath === "/login" || nextPath === "/register";
  const next = skip ? "" : `?next=${encodeURIComponent(nextPath)}`;
  go("/login" + next, { replace: true });
}

function sessionExpired() {
  const { path } = parseHash();
  store.clear();
  setFlash("info", "Сесія закінчилась. Увійдіть знову.");
  goLogin(routes[path] && routes[path].auth ? path : "/profile");
}

function safeNext(next) {
  if (!next || !next.startsWith("/") || next.startsWith("//")) return null;
  const route = routes[next.split("?")[0]];
  return route && !route.guestOnly ? next : null;
}

function renderNav(currentPath) {
  const link = (path, text) =>
    `<a class="nav-link ${currentPath === path ? "active" : ""}" href="#${path}">${text}</a>`;
  let html = `<a class="brand" href="#/">GearRent</a>${link("/", "Каталог")}`;
  if (isLoggedIn()) {
    html += link("/profile", "Профіль");
    if (isAdmin()) html += link("/users", "Користувачі");
    html += `<span class="spacer"></span>
      <span class="user-name">Привіт, ${esc(displayName(store.user))}</span>
      <button class="btn light" id="logout-btn" type="button">Вийти</button>`;
  } else {
    html += `<span class="spacer"></span>
      <a class="btn light" href="#/login">Увійти</a>
      <a class="btn light" href="#/register">Реєстрація</a>`;
  }
  navEl.innerHTML = html;
  const logoutBtn = document.getElementById("logout-btn");
  if (logoutBtn) logoutBtn.addEventListener("click", logout);
}

function logout() {
  store.clear();
  go("/");
}

let renderId = 0;
async function router() {
  const id = ++renderId;
  const { path, params } = parseHash();
  const route = routes[path] || { render: viewNotFound };

  if (route.auth && !isLoggedIn()) {
    goLogin(path);
    return;
  }
  if (route.guestOnly && isLoggedIn()) {
    go("/profile", { replace: true });
    return;
  }
  renderNav(path);
  await route.render({ params, isStale: () => id !== renderId });
}

function viewNotFound() {
  appEl.innerHTML = `<div class="card"><h1>Сторінку не знайдено</h1>
    <p><a href="#/">До каталогу</a></p></div>`;
}

async function viewCatalog({ isStale }) {
  appEl.innerHTML = `
    ${takeFlash()}
    <div class="page-head">
      <h1>Каталог спорядження</h1>
      ${isLoggedIn() ? '<a class="btn" href="#/products/new">Додати товар</a>' : ""}
    </div>
    <form id="filters" class="filters">
      <input id="search" type="search" placeholder="Пошук за назвою">
      <select id="category"><option value="">Усі категорії</option></select>
      <select id="brand"><option value="">Усі бренди</option></select>
      <select id="sort">
        <option value="">Без сортування</option>
        <option value="price_per_day">Ціна: від дешевших</option>
        <option value="-price_per_day">Ціна: від дорожчих</option>
        <option value="name">Назва: А-Я</option>
      </select>
    </form>
    <div id="message" class="message" hidden></div>
    <div id="products" class="grid"></div>`;

  const productsEl = document.getElementById("products");
  const messageEl = document.getElementById("message");
  const searchEl = document.getElementById("search");
  const categoryEl = document.getElementById("category");
  const brandEl = document.getElementById("brand");
  const sortEl = document.getElementById("sort");

  function showMessage(text, isError) {
    messageEl.textContent = text;
    messageEl.className = isError ? "message error" : "message";
    messageEl.hidden = !text;
  }

  function createCard(product) {
    const card = document.createElement("article");
    card.className = "card";

    const title = document.createElement("h2");
    title.textContent = product.name;

    const meta = document.createElement("div");
    meta.className = "meta";
    meta.textContent = product.category_name + " · " + product.brand_name;

    const description = document.createElement("p");
    description.textContent = product.description;

    const price = document.createElement("div");
    price.className = "price";
    price.textContent = Number(product.price_per_day).toFixed(2) + " грн / доба";

    const badge = document.createElement("span");
    badge.className = product.is_available ? "badge" : "badge unavailable";
    badge.textContent = product.is_available ? "Доступно" : "Недоступно";

    card.append(title, meta, description, price, badge);

  
    if (isAdmin()) {
      const actions = document.createElement("div");
      actions.className = "card-actions";
      const del = document.createElement("button");
      del.type = "button";
      del.className = "btn danger";
      del.textContent = "Видалити";
      del.addEventListener("click", () => deleteProduct(product));
      actions.appendChild(del);
      card.appendChild(actions);
    }
    return card;
  }

  async function deleteProduct(product) {
    if (!confirm(`Видалити товар «${product.name}»?`)) return;
    try {
      await authFetch(`/products/${product.id}`, { method: "DELETE" });
      showMessage(`Товар «${product.name}» видалено.`, false);
      await loadProducts(true);
    } catch (error) {
      if (error.status !== 401) showMessage(error.message, true);
    }
  }

  async function loadProducts(keepMessage = false) {
    try {
    
      const products = await rawFetch("/products", {
        params: {
          search: searchEl.value.trim(),
          category_id: categoryEl.value,
          brand_id: brandEl.value,
          sort_by: sortEl.value,
        },
      });
      if (isStale()) return;
      productsEl.replaceChildren(...products.map(createCard));
      if (!keepMessage || !products.length) {
        showMessage(products.length ? "" : "Нічого не знайдено.", false);
      }
    } catch (error) {
      if (isStale()) return;
      productsEl.replaceChildren();
      showMessage("Не вдалося отримати дані з API: " + error.message, true);
    }
  }
const filtersForm = document.getElementById("filters");
  if (filtersForm) {
    filtersForm.addEventListener("submit", (event) => {
      event.preventDefault();
    });
  }

  if (searchEl) {
    searchEl.addEventListener("input", () => loadProducts());
  }

  [categoryEl, brandEl, sortEl].forEach((el) => {
    if (el) {
      el.addEventListener("change", () => loadProducts());
    }
  });

  try {
    const [categories, brands] = await Promise.all([
      rawFetch("/categories"),
      rawFetch("/brands"),
    ]);
    if (isStale()) return;
    fillSelect(categoryEl, categories);
    fillSelect(brandEl, brands);
  } catch {
  
  }
  await loadProducts();
}

function viewLogin({ params }) {
  appEl.innerHTML = `
    <div class="card form-card">
      <h1>Вхід</h1>
      ${takeFlash()}
      <form id="login-form" novalidate>
        <div class="alert error form-error"></div>
        ${field("username", "Ім'я користувача", { autocomplete: "username" })}
        ${field("password", "Пароль", { type: "password", autocomplete: "current-password" })}
        <button class="btn" type="submit">Увійти</button>
      </form>
      <p class="muted">Немає акаунта? <a href="#/register">Зареєструватися</a></p>
    </div>`;

  const form = document.getElementById("login-form");
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearFormErrors(form);
    const body = {
      username: form.username.value.trim(),
      password: form.password.value,
    };
    const errors = {};
    if (!body.username) errors.username = ["Введіть ім'я користувача."];
    if (!body.password) errors.password = ["Введіть пароль."];
    if (Object.keys(errors).length) {
      showFormErrors(form, { fields: errors, general: "" });
      return;
    }

    const button = form.querySelector("button");
    button.disabled = true;
    try {
      const data = await rawFetch("/auth/login", { method: "POST", body });
      store.save({ access: data.access, refresh: data.refresh, user: data.user });
    
      go(safeNext(params.get("next")) || "/", { replace: true });
    } catch (error) {
      showFormErrors(form, errorToInfo(error));
    } finally {
      button.disabled = false;
    }
  });
}

function validateRegister(values) {
  const errors = {};
  const required = (name, message) => {
    if (!values[name]) errors[name] = [message];
  };
  required("username", "Введіть ім'я користувача.");
  required("email", "Введіть email.");
  required("password", "Введіть пароль.");
  required("password_confirm", "Повторіть пароль.");
  for (const [name, max] of Object.entries(FIELD_LIMITS)) {
    if (values[name] && values[name].length > max && !errors[name]) {
      errors[name] = [`Максимум ${max} символів.`];
    }
  }
  if (values.email && !errors.email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(values.email)) {
    errors.email = ["Введіть коректний email, наприклад name@example.com."];
  }
  if (values.password && !errors.password && values.password.length < PASSWORD_MIN) {
    errors.password = [`Пароль має містити щонайменше ${PASSWORD_MIN} символів.`];
  }
  if (values.password && values.password_confirm && values.password !== values.password_confirm) {
    errors.password_confirm = ["Паролі не збігаються."];
  }
  return errors;
}

function viewRegister() {
  appEl.innerHTML = `
    <div class="card form-card">
      <h1>Реєстрація</h1>
      <form id="register-form" novalidate>
        <div class="alert error form-error"></div>
        ${field("username", "Ім'я користувача", { autocomplete: "username" })}
        ${field("first_name", "Ім'я", { optional: true, autocomplete: "given-name" })}
        ${field("last_name", "Прізвище", { optional: true, autocomplete: "family-name" })}
        ${field("email", "Email", { type: "email", autocomplete: "email" })}
        ${field("password", "Пароль", { type: "password", autocomplete: "new-password" })}
        ${field("password_confirm", "Повторіть пароль", { type: "password", autocomplete: "new-password" })}
        <button class="btn" type="submit">Зареєструватися</button>
      </form>
      <p class="muted">Вже є акаунт? <a href="#/login">Увійти</a></p>
    </div>`;

  const form = document.getElementById("register-form");
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearFormErrors(form);
    const body = {
      username: form.username.value.trim(),
      first_name: form.first_name.value.trim(),
      last_name: form.last_name.value.trim(),
      email: form.email.value.trim(),
      password: form.password.value,
      password_confirm: form.password_confirm.value,
    };
    const errors = validateRegister(body);
    if (Object.keys(errors).length) {
      showFormErrors(form, { fields: errors, general: "" });
      return;
    }

    const button = form.querySelector("button");
    button.disabled = true;
    try {
      await rawFetch("/auth/register", { method: "POST", body });
      setFlash("success", "Реєстрація успішна. Тепер увійдіть у свій акаунт.");
      go("/login");
    } catch (error) {
      showFormErrors(form, errorToInfo(error));
    } finally {
      button.disabled = false;
    }
  });
}

async function viewProfile({ isStale }) {
  appEl.innerHTML = `<div class="card"><h1>Профіль</h1><p class="muted">Завантаження…</p></div>`;
  try {
    const user = await authFetch("/users/me");
    if (isStale()) return;
    store.save({ user });
    renderNav("/profile");
    const role = user.is_staff
      ? '<span class="badge admin">Адміністратор</span>'
      : '<span class="badge user">Користувач</span>';
    appEl.innerHTML = `
      <div class="card">
        <h1>Профіль</h1>
        <p class="muted">Ця сторінка доступна лише авторизованим користувачам.</p>
        <dl class="profile">
          <dt>Ім'я користувача</dt><dd>${esc(user.username)}</dd>
          <dt>Ім'я</dt><dd>${esc(user.first_name) || '<span class="muted">не вказано</span>'}</dd>
          <dt>Прізвище</dt><dd>${esc(user.last_name) || '<span class="muted">не вказано</span>'}</dd>
          <dt>Email</dt><dd>${esc(user.email)}</dd>
          <dt>Роль</dt><dd>${role}</dd>
        </dl>
        <div class="actions">
          <a class="btn" href="#/products/new">Додати товар</a>
          ${user.is_staff ? '<a class="btn secondary" href="#/users">Список користувачів</a>' : ""}
        </div>
      </div>`;
  } catch (error) {
  
    if (isStale() || error.status === 401) return;
    appEl.innerHTML = `<div class="card"><h1>Профіль</h1>
      <div class="alert error">${esc(error.message)}</div></div>`;
  }
}

async function viewProductForm({ isStale }) {
  appEl.innerHTML = `<div class="card form-card"><h1>Новий товар</h1><p class="muted">Завантаження…</p></div>`;
  let categories;
  let brands;
  try {
    [categories, brands] = await Promise.all([rawFetch("/categories"), rawFetch("/brands")]);
  } catch (error) {
    if (isStale()) return;
    appEl.innerHTML = `<div class="card form-card"><h1>Новий товар</h1>
      <div class="alert error">${esc(error.message)}</div></div>`;
    return;
  }
  if (isStale()) return;

  appEl.innerHTML = `
    <div class="card form-card">
      <h1>Новий товар</h1>
      <form id="product-form" novalidate>
        <div class="alert error form-error"></div>
        <label for="name">Назва</label>
        <input id="name" name="name" type="text" maxlength="200">
        <small class="field-error" data-error-for="name"></small>

        <label for="description">Опис <span class="opt">(необов'язково)</span></label>
        <textarea id="description" name="description" rows="3"></textarea>
        <small class="field-error" data-error-for="description"></small>

        <label for="price_per_day">Ціна за добу, грн</label>
        <input id="price_per_day" name="price_per_day" type="number" min="0.01" step="0.01">
        <small class="field-error" data-error-for="price_per_day"></small>

        <label for="category_id">Категорія</label>
        <select id="category_id" name="category_id"><option value="">Оберіть категорію</option></select>
        <small class="field-error" data-error-for="category_id"></small>

        <label for="brand_id">Бренд</label>
        <select id="brand_id" name="brand_id"><option value="">Оберіть бренд</option></select>
        <small class="field-error" data-error-for="brand_id"></small>

        <label class="check"><input name="is_available" type="checkbox" checked> Доступний для оренди</label>
        <button class="btn" type="submit">Додати товар</button>
      </form>
      <p class="muted"><a href="#/">Скасувати</a></p>
    </div>`;

  const form = document.getElementById("product-form");
  fillSelect(form.category_id, categories);
  fillSelect(form.brand_id, brands);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearFormErrors(form);
    const price = parseFloat(form.price_per_day.value);
    const errors = {};
    if (!form.elements.name.value.trim()) errors.name = ["Введіть назву."];
    if (!(price > 0)) errors.price_per_day = ["Ціна за добу має бути більшою за 0."];
    if (!form.category_id.value) errors.category_id = ["Оберіть категорію."];
    if (!form.brand_id.value) errors.brand_id = ["Оберіть бренд."];
    if (Object.keys(errors).length) {
      showFormErrors(form, { fields: errors, general: "" });
      return;
    }

    const body = {
      name: form.elements.name.value.trim(),
      description: form.description.value.trim(),
      price_per_day: price,
      category_id: Number(form.category_id.value),
      brand_id: Number(form.brand_id.value),
      is_available: form.is_available.checked,
    };
    const button = form.querySelector("button");
    button.disabled = true;
    try {
      await authFetch("/products", { method: "POST", body });
      setFlash("success", `Товар «${body.name}» додано.`);
      go("/");
    } catch (error) {
      if (error.status !== 401) showFormErrors(form, errorToInfo(error));
    } finally {
      button.disabled = false;
    }
  });
}

async function viewUsers({ isStale }) {
  appEl.innerHTML = `<div class="card"><h1>Користувачі</h1><p class="muted">Завантаження…</p></div>`;
  try {
    const data = await authFetch("/users");
    if (isStale()) return;
    const users = Array.isArray(data) ? data : data.results || [];
    const rows = users
      .map(
        (user) => `<tr>
          <td>${esc(user.id)}</td><td>${esc(user.username)}</td><td>${esc(user.email)}</td>
          <td>${user.is_staff ? "Адміністратор" : "Користувач"}</td>
        </tr>`
      )
      .join("");
    appEl.innerHTML = `
      <div class="card">
        <h1>Користувачі</h1>
        <p class="muted">Сторінка лише для адміністраторів.</p>
        <table>
          <thead><tr><th>ID</th><th>Username</th><th>Email</th><th>Роль</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  } catch (error) {
    if (isStale() || error.status === 401) return;
    appEl.innerHTML = `<div class="card"><h1>Користувачі</h1>
      <div class="alert error">${esc(error.message)}</div>
      <p><a href="#/profile">До профілю</a></p></div>`;
  }
}

window.addEventListener("hashchange", router);
window.addEventListener("storage", (event) => {

  if (Object.values(KEYS).includes(event.key)) router();
});
document.addEventListener("DOMContentLoaded", router);

window.GearAuth = { store, authFetch, rawFetch, errorInfo, refreshAccess, isLoggedIn };
