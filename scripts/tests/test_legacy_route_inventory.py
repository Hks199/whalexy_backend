import importlib.util
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('route_inventory', Path(__file__).resolve().parents[1] / 'legacy_route_inventory.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class RouteInventoryTests(unittest.TestCase):
    def test_real_source_prefixes_and_chained_user_route(self):
        routes = module.inventory()
        self.assertEqual(len(routes), 648)
        self.assertEqual(sum(r['source'] == 'routes/api.php' for r in routes), 35)
        self.assertTrue(any(r['fullPath'] == '/api/user' and r['method'] == 'GET' for r in routes))
        self.assertTrue(any(r['fullPath'] == '/api/user/logout' for r in routes))
        self.assertTrue(any(r['fullPath'] == '/vendor-console/appointments/services' for r in routes))
        self.assertTrue(any(r['fullPath'] == '/api/{vendorUid}/appointments/resources/{resourceUid}/schedule' for r in routes))

    def test_nested_groups_includes_comments_and_methods(self):
        previous = module.SOURCE
        try:
            with tempfile.TemporaryDirectory() as directory:
                module.SOURCE = Path(directory)
                main = module.SOURCE / 'main.php'
                main.write_text("""<?php
// Route::get('/ignored', []);
Route::middleware('web')->group(function () {
    Route::group(['prefix' => 'outer'], function () {
        require __DIR__.'/child.php';
        Route::prefix('inner')->group(function () {
            Route::match(['get', 'post'], '/both', []);
        });
    });
    Route::any('/root', []);
});
""", encoding='utf-8')
                (module.SOURCE / 'child.php').write_text("<?php Route::middleware('auth')->get('/user', []);", encoding='utf-8')
                routes = module.inspect_file(main, '/api')
                self.assertEqual({r['fullPath'] for r in routes}, {'/api/outer/user', '/api/outer/inner/both', '/api/root'})
                self.assertEqual(next(r['methods'] for r in routes if r['method'] == 'MATCH'), ['GET', 'POST'])
                self.assertEqual(len(next(r['methods'] for r in routes if r['method'] == 'ANY')), 7)
        finally:
            module.SOURCE = previous


if __name__ == '__main__':
    unittest.main()
