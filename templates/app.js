const API_BASE_URL = "http://127.0.0.1:8000/api/v1";

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

async function apiGet(path, params) {
  const url = new URL(API_BASE_URL + path);
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value) {
      url.searchParams.set(key, value);
    }
  });
  const response = await fetch(url);
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error ? data.error.message : "Помилка сервера");
  }
  return data;
}

function fillSelect(select, items) {
  items.forEach((item) => {
    const option = document.createElement("option");
    option.value = item.id;
    option.textContent = item.name;
    select.appendChild(option);
  });
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
  price.textContent = product.price_per_day.toFixed(2) + " грн / доба";

  const badge = document.createElement("span");
  badge.className = product.is_available ? "badge" : "badge unavailable";
  badge.textContent = product.is_available ? "Доступно" : "Недоступно";

  card.append(title, meta, description, price, badge);
  return card;
}

async function loadProducts() {
  try {
    const products = await apiGet("/products", {
      search: searchEl.value.trim(),
      category_id: categoryEl.value,
      brand_id: brandEl.value,
      sort_by: sortEl.value,
    });
    productsEl.replaceChildren(...products.map(createCard));
    showMessage(products.length ? "" : "Нічого не знайдено.", false);
  } catch (error) {
    productsEl.replaceChildren();
    showMessage(
      "Не вдалося отримати дані з API: " + error.message +
      ". Перевірте, що бекенд запущено на " + API_BASE_URL,
      true
    );
  }
}

async function init() {
  try {
    fillSelect(categoryEl, await apiGet("/categories"));
    fillSelect(brandEl, await apiGet("/brands"));
  } catch (error) {

  }
  await loadProducts();
}

document.getElementById("filters").addEventListener("submit", (event) => {
  event.preventDefault();
});
searchEl.addEventListener("input", loadProducts);
[categoryEl, brandEl, sortEl].forEach((el) => {
  el.addEventListener("change", loadProducts);
});

init();