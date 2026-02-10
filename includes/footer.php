    <script src="https://cdnjs.cloudflare.com/ajax/libs/cropperjs/1.6.1/cropper.min.js"></script>
    <script>
    (function() {
        function isStandaloneWebapp() {
            return window.matchMedia('(display-mode: standalone)').matches
                || (window.navigator.standalone === true);
        }
        if (!isStandaloneWebapp()) return;
        document.querySelectorAll('a[href*="auth/google.php"], a[href*="auth/yandex.php"]').forEach(function(a) {
            var href = a.getAttribute('href');
            if (!href) return;
            if (href.indexOf('auth/google.php') !== -1 || href.indexOf('auth/yandex.php') !== -1) {
                if (href.indexOf('display=standalone') !== -1) return;
                a.setAttribute('href', href + (href.indexOf('?') !== -1 ? '&' : '?') + 'display=standalone');
            }
        });
    })();
    </script>
    <script src="<?php echo BASE_URL; ?>assets/js/app.js?v=<?php echo filemtime(__DIR__ . '/../assets/js/app.js'); ?>"></script>
    <?php if (isset($additionalJS)): ?>
        <?php foreach ($additionalJS as $js): ?>
            <script src="<?php echo BASE_URL . $js; ?>?v=<?php echo filemtime(__DIR__ . '/../' . $js); ?>"></script>
        <?php endforeach; ?>
    <?php endif; ?>
</body>
</html>
