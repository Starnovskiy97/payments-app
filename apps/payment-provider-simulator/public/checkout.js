const id = encodeURIComponent(window.location.pathname.split('/').at(-1));
let invoice;
const element = (name) => document.getElementById(name);

function render(data) {
  invoice = data;
  element('amount').textContent = new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency: 'RUB',
  }).format(data.amount / 100);
  element('details').textContent = JSON.stringify(data, null, 2);
  element('success').disabled = element('failure').disabled = data.status !== 'pending';
  element('repeat').disabled = data.status === 'pending';
}

async function complete(status) {
  for (const button of document.querySelectorAll('button')) button.disabled = true;
  element('message').textContent = 'Обрабатываем результат…';
  try {
    const { data } = await axios.post(`/provider/payments/${id}/complete`, {
      status,
      delivery: element('delivery').value,
      delayMs: Number(element('delay').value),
      copies: Number(element('copies').value),
    });
    render(data);
    element('message').textContent = `Результат сохранён. Доставка webhook: ${data.webhookStatus}`;
  } catch (error) {
    element('message').textContent = error.response?.data?.message ?? error.message;
    if (invoice) render(invoice);
  }
}

element('success').onclick = () => complete('succeeded');
element('failure').onclick = () => complete('failed');
element('repeat').onclick = () => complete(invoice.status);

axios
  .get(`/checkout/${id}/state`)
  .then(({ data }) => {
    render(data);
  })
  .catch((error) => {
    element('message').textContent = error.message;
  });
