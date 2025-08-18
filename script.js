fetch('http://localhost:12345/sysinfo')
  .then(res => res.json())
  .then(data => {
    document.body.innerHTML += `<div>${JSON.stringify(data)}</div>`;
  })
  .catch(err => {
    document.body.innerHTML += `<div style="color:red;">Fetch error: ${err}</div>`;
  });