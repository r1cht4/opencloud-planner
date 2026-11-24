<template>
  <div class="detail-root">
    <div class="detail-header">
      <div class="detail-header-left">
        <img
          v-if="safePhotoSrc(contact.photo)"
          :src="safePhotoSrc(contact.photo)"
          class="avatar-lg avatar-photo"
          alt=""
        />
        <div v-else class="avatar-lg" :style="{ backgroundColor: avatarColor }">
          {{ initials }}
        </div>
        <div>
          <h2 class="detail-name">{{ contact.displayName }}</h2>
          <p v-if="contact.title || contact.organization" class="detail-role">
            <span v-if="contact.title">{{ contact.title }}</span>
            <span v-if="contact.title && contact.organization"> &middot; </span>
            <span v-if="contact.organization">{{ contact.organization }}</span>
          </p>
          <div v-if="contact.categories?.length" class="detail-categories">
            <span v-for="cat in contact.categories" :key="cat" class="category-tag">{{ cat }}</span>
          </div>
        </div>
      </div>
      <div class="detail-actions">
        <oc-button appearance="outline" @click="$emit('edit', contact)">
          <oc-icon name="pencil" size="small" />
          <span>{{ $gettext('Edit') }}</span>
        </oc-button>
        <oc-button appearance="outline" class="delete-btn" @click="$emit('delete', contact)">
          <oc-icon name="delete-bin" size="small" />
          <span>{{ $gettext('Delete') }}</span>
        </oc-button>
      </div>
    </div>

    <div class="detail-sections">
      <section v-if="contact.emails.length > 0">
        <h3 class="section-heading">{{ $gettext('Email') }}</h3>
        <div v-for="(email, idx) in contact.emails" :key="idx" class="section-row">
          <oc-icon name="mail" size="small" />
          <a :href="`mailto:${email.value}`" class="link">{{ email.value }}</a>
          <span class="badge">{{ email.type }}</span>
        </div>
      </section>

      <section v-if="contact.phones.length > 0">
        <h3 class="section-heading">{{ $gettext('Phone') }}</h3>
        <div v-for="(phone, idx) in contact.phones" :key="idx" class="section-row">
          <oc-icon name="phone" size="small" />
          <a :href="`tel:${phone.value}`" class="link">{{ phone.value }}</a>
          <span class="badge">{{ phone.type }}</span>
        </div>
      </section>

      <section v-if="contact.addresses.length > 0">
        <h3 class="section-heading">{{ $gettext('Address') }}</h3>
        <div v-for="(addr, idx) in contact.addresses" :key="idx" class="address-block">
          <oc-icon name="map-pin" size="small" class="address-icon" />
          <div>
            <div v-if="addr.street">{{ addr.street }}</div>
            <div v-if="addr.postalCode || addr.city">
              {{ [addr.postalCode, addr.city].filter(Boolean).join(' ') }}
            </div>
            <div v-if="addr.region">{{ addr.region }}</div>
            <div v-if="addr.country">{{ addr.country }}</div>
            <span class="badge">{{ addr.type }}</span>
          </div>
        </div>
      </section>

      <section v-if="contact.birthday">
        <h3 class="section-heading">{{ $gettext('Birthday') }}</h3>
        <div class="section-row">
          <oc-icon name="cake" size="small" />
          <span>{{ formattedBirthday }}</span>
        </div>
      </section>

      <section v-if="contact.notes">
        <h3 class="section-heading">{{ $gettext('Notes') }}</h3>
        <p class="notes-text">{{ contact.notes }}</p>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useGettext } from 'vue3-gettext'
import { useFormatLocale } from '../settings/formatLocale'
import { safePhotoSrc } from '../composables/useContactsService'
import { avatarColor as resolveAvatarColor, contactInitials } from '../composables/contactAvatar'
import type { Contact } from '../types'

const { $gettext } = useGettext()
const formatLocale = useFormatLocale()
const props = defineProps<{ contact: Contact }>()
defineEmits<{ edit: [contact: Contact]; delete: [contact: Contact] }>()

const formattedBirthday = computed(() => {
  if (!props.contact.birthday) return ''
  const d = new Date(props.contact.birthday + 'T00:00:00')
  const locale = formatLocale.value
  return d.toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' })
})

const initials = computed(() => contactInitials(props.contact.displayName))

const avatarColor = computed(() => resolveAvatarColor(props.contact.displayName))
</script>

<style scoped>
.detail-root {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.detail-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 16px;
}
.detail-header-left {
  display: flex;
  align-items: center;
  gap: 16px;
}

.avatar-lg {
  width: 64px;
  height: 64px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-weight: 700;
  font-size: 1.25rem;
  flex-shrink: 0;
}
.avatar-photo {
  object-fit: cover;
}

.detail-categories {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 4px;
}
.category-tag {
  font-size: 0.6875rem;
  padding: 2px 8px;
  border-radius: 12px;
  background: var(--oc-role-primary-container, #b7eaff);
  color: var(--oc-role-on-primary-container, #001f29);
}

.detail-name {
  font-size: 1.5rem;
  font-weight: 600;
}
.detail-role {
  color: var(--oc-role-on-surface-variant, #40484c);
  font-size: 0.875rem;
  margin-top: 2px;
}
.detail-actions {
  display: flex;
  gap: 8px;
}

.delete-btn {
  --oc-color-text-default: var(--oc-role-error, #ba1a1a);
}

.detail-sections {
  display: grid;
  gap: 24px;
}

.section-heading {
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: 8px;
  color: var(--oc-role-outline, #70787c);
}

.section-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 0;
}

.link {
  color: var(--oc-role-secondary, #20434f);
  text-decoration: none;
}
.link:hover {
  text-decoration: underline;
}

.badge {
  font-size: 0.6875rem;
  text-transform: capitalize;
  padding: 2px 8px;
  border-radius: 4px;
  background: var(--oc-role-surface-container, #eceef0);
  color: var(--oc-role-on-surface-variant, #40484c);
}

.address-block {
  display: flex;
  gap: 8px;
  padding: 4px 0;
  font-size: 0.875rem;
}
.address-icon {
  flex-shrink: 0;
  margin-top: 2px;
}
.notes-text {
  font-size: 0.875rem;
  white-space: pre-wrap;
}
</style>
