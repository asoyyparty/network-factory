const express = require('express');
const router = express.Router();
const db = require('../db/database');

async function logTopologyAudit(req, action, detail) {
  try {
    const username = (req.user && req.user.username) ? req.user.username : 'system';
    const ip = req.ip || req.connection.remoteAddress || '127.0.0.1';
    await db.query(
      'INSERT INTO audit_logs (username, action_category, action_detail, ip_address, status) VALUES (?, ?, ?, ?, ?)',
      [username, 'TOPOLOGY', `${action}: ${detail}`, ip, 'SUCCESS']
    );
  } catch (e) {
    console.warn('[Audit] Gagal log audit topologi:', e.message);
  }
}

// GET /api/topology
// Mengambil semua node topologi
router.get('/', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM topology_nodes ORDER BY parent_id, order_idx ASC');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/topology
// Menambah node baru
router.post('/', async (req, res) => {
  try {
    const { id, label, kind, loc_id, parent_id, extra_parents } = req.body;
    const newId = id || 'node_' + Date.now();
    await db.query(
      'INSERT INTO topology_nodes (id, label, kind, loc_id, parent_id, extra_parents, order_idx) VALUES (?, ?, ?, ?, ?, ?, 0)',
      [newId, label, kind, loc_id || null, parent_id || null, extra_parents ? JSON.stringify(extra_parents) : null]
    );
    await logTopologyAudit(req, 'TAMBAH_NODE', `Node '${label}' (${kind}) ditambahkan sebagai anak dari ${parent_id || 'Root'}`);
    res.json({ message: 'Node berhasil ditambahkan', id: newId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/topology/:id
// Mengupdate node (label, parent, dll)
router.put('/:id', async (req, res) => {
  try {
    const { label, kind, loc_id, parent_id, extra_parents, order_idx } = req.body;
    await db.query(
      'UPDATE topology_nodes SET label=?, kind=?, loc_id=?, parent_id=?, extra_parents=?, order_idx=COALESCE(?, order_idx) WHERE id=?',
      [label, kind, loc_id || null, parent_id || null, extra_parents ? JSON.stringify(extra_parents) : null, order_idx !== undefined ? order_idx : null, req.params.id]
    );
    await logTopologyAudit(req, 'UBAH_NODE', `Node '${label}' [${req.params.id}] diperbarui`);
    res.json({ message: 'Node berhasil diupdate' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/topology/:id/move
// Memindahkan urutan node (up/down) di antara saudara se-induk
router.post('/:id/move', async (req, res) => {
  try {
    const { direction } = req.body;
    const [currentNode] = await db.query('SELECT id, label, parent_id, order_idx FROM topology_nodes WHERE id = ?', [req.params.id]);
    if (!currentNode.length) return res.status(404).json({ error: 'Node tidak ditemukan' });
    const node = currentNode[0];

    const parentIdClause = node.parent_id === null ? 'parent_id IS NULL' : 'parent_id = ?';
    const params = node.parent_id === null ? [] : [node.parent_id];

    const [siblings] = await db.query(
      `SELECT id, order_idx FROM topology_nodes WHERE ${parentIdClause} ORDER BY order_idx ASC, id ASC`,
      params
    );

    const idx = siblings.findIndex(s => s.id === node.id);
    if (direction === 'up' && idx > 0) {
      const prev = siblings[idx - 1];
      const curOrder = node.order_idx;
      const prevOrder = prev.order_idx;
      const newCur = prevOrder;
      const newPrev = curOrder === prevOrder ? curOrder + 1 : curOrder;
      await db.query('UPDATE topology_nodes SET order_idx = ? WHERE id = ?', [newCur, node.id]);
      await db.query('UPDATE topology_nodes SET order_idx = ? WHERE id = ?', [newPrev, prev.id]);
      await logTopologyAudit(req, 'URUTKAN_NODE', `Pindahkan '${node.label}' ke atas`);
    } else if (direction === 'down' && idx < siblings.length - 1) {
      const next = siblings[idx + 1];
      const curOrder = node.order_idx;
      const nextOrder = next.order_idx;
      const newCur = nextOrder;
      const newNext = curOrder === nextOrder ? nextOrder - 1 : curOrder;
      await db.query('UPDATE topology_nodes SET order_idx = ? WHERE id = ?', [newCur, node.id]);
      await db.query('UPDATE topology_nodes SET order_idx = ? WHERE id = ?', [newNext, next.id]);
      await logTopologyAudit(req, 'URUTKAN_NODE', `Pindahkan '${node.label}' ke bawah`);
    }

    res.json({ message: 'Urutan berhasil dipindahkan' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/topology/:id
router.delete('/:id', async (req, res) => {
  try {
    const [existing] = await db.query('SELECT label FROM topology_nodes WHERE id = ?', [req.params.id]);
    const label = existing.length ? existing[0].label : req.params.id;

    await db.query('UPDATE topology_nodes SET parent_id = NULL WHERE parent_id = ?', [req.params.id]);
    await db.query('DELETE FROM topology_nodes WHERE id = ?', [req.params.id]);
    await logTopologyAudit(req, 'HAPUS_NODE', `Node '${label}' [${req.params.id}] dihapus`);
    res.json({ message: 'Node berhasil dihapus' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

