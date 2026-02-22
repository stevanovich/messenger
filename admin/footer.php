    </main>
    <?php if (function_exists('getTwemojiEnabled') && getTwemojiEnabled()): ?>
    <script src="https://cdn.jsdelivr.net/npm/twemoji@14.0.2/dist/twemoji.min.js" crossorigin="anonymous"></script>
    <?php endif; ?>
    <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
    <?php if (isset($additionalJS)): foreach ($additionalJS as $js): ?>
        <script src="<?= BASE_URL . $js ?>"></script>
    <?php endforeach; endif; ?>
</body>
</html>
