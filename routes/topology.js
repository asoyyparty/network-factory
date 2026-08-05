const express = require('express');
const router = express.Router();
const db = require('../db/database');

// GET /api/topology
// Mengambil semua node topologi
router.get('/', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM topology_nodes ORDER BY parent_id, order_idx ASC');
    // Reconstruct the tree or send flat
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
    res.json({ message: 'Node berhasil ditambahkan', id: newId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/topology/:id
// Mengupdate node (label, parent, dll)
router.put('/:id', async (req, res) => {
  try {
    const { label, kind, loc_id, parent_id, extra_parents } = req.body;
    await db.query(
      'UPDATE topology_nodes SET label=?, kind=?, loc_id=?, parent_id=?, extra_parents=? WHERE id=?',
      [label, kind, loc_id || null, parent_id || null, extra_parents ? JSON.stringify(extra_parents) : null, req.params.id]
    );
    res.json({ message: 'Node berhasil diupdate' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/topology/:id
router.delete('/:id', async (req, res) => {
  try {
    // Delete cascading is usually better, but for now just delete the node and let orphans be attached to root or throw error
    // Alternatively, update children's parent_id to null
    await db.query('UPDATE topology_nodes SET parent_id = NULL WHERE parent_id = ?', [req.params.id]);
    await db.query('DELETE FROM topology_nodes WHERE id = ?', [req.params.id]);
    res.json({ message: 'Node berhasil dihapus' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
