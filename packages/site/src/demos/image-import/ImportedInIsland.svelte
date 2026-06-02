<script lang="ts">
  import { isServer } from 'mochi-framework';
  import mochiImage from '../../../images/mochi-1.jpg';

  const env = isServer ? 'server' : 'client';
</script>

<figure>
  <figcaption>Imported inside a hydrated island — resolved on the <strong>{env}</strong>:</figcaption>
  <code>{mochiImage}</code>
  <img src={mochiImage} alt="mochi" />
</figure>

<style>
  figure {
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  img {
    max-width: 100%;
    border-radius: 8px;
  }
</style>
