document.addEventListener('DOMContentLoaded', function () {
  document.querySelectorAll('.dropdown > a').forEach(function (toggle) {
    toggle.addEventListener('click', function (e) {
      e.preventDefault();
      var parent = this.parentElement;
      // Close other open dropdowns
      document.querySelectorAll('.dropdown.active').forEach(function (d) {
        if (d !== parent) d.classList.remove('active');
      });
      parent.classList.toggle('active');
    });
  });

  // Close dropdown when clicking outside
  document.addEventListener('click', function (e) {
    if (!e.target.closest('.dropdown')) {
      document.querySelectorAll('.dropdown.active').forEach(function (d) {
        d.classList.remove('active');
      });
    }
  });
});
