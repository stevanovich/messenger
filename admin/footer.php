    </main>
    <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
    <?php if (isset($additionalJS)): foreach ($additionalJS as $js): ?>
        <script src="<?= BASE_URL . $js ?>"></script>
    <?php endforeach; endif; ?>
</body>
</html>
