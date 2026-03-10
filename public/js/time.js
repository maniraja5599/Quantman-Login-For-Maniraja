(function () {
  function pad(n) { return n < 10 ? '0' + n : String(n); }

  function showTime() {
    var el = document.getElementById('topbar-time');
    if (!el) return;
    var d = new Date();
    var dd = pad(d.getDate());
    var mm = pad(d.getMonth() + 1);
    var yyyy = d.getFullYear();
    var h = d.getHours();
    var ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    el.textContent = dd + '-' + mm + '-' + yyyy + ', ' + pad(h) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()) + ' ' + ampm;
  }
  showTime();
  setInterval(showTime, 1000);
})();
