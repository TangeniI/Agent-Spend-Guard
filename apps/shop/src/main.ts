import { createShopServer } from './shop.js';

const port = Number(process.env.SHOP_PORT ?? 3002);
createShopServer().listen(port, () => console.log(`shop listening on ${port}`));
